package api

import (
	"bytes"
	"io"
	"mime"
	"net/http"
	"path/filepath"
	"strconv"
	"strings"
	"unicode/utf8"

	"keryx-server/internal/store"
)

const (
	maxAttachmentsPerRequest = 3
	maxAttachmentBytes       = 20 << 20 // 20 MB per original file
	maxConvertedBytes        = 50 << 20 // 50 MB per Markdown conversion
)

// Document container magic bytes. http.DetectContentType only reports
// "application/zip" for OOXML/OpenDocument/EPUB files and "application/vnd.ms-office"
// for legacy OLE2 files, so we sniff the container kind explicitly instead of
// relying on the exact sniffed string.
var (
	zipMagic  = []byte{0x50, 0x4B, 0x03, 0x04}
	ole2Magic = []byte{0xD0, 0xCF, 0x11, 0xE0, 0xA1, 0xB1, 0x1A, 0xE1}
)

// allowedAttachmentTypes whitelists uploadable file types. Extensions map to
// the kind sniffed from the first bytes of the file — either a magic container
// kind (pdf/zip/ole2) or the value returned by http.DetectContentType — so a
// renamed executable can't pass as a document.
var allowedAttachmentTypes = map[string][]string{
	".png":  {"image/png"},
	".jpg":  {"image/jpeg"},
	".jpeg": {"image/jpeg"},
	".gif":  {"image/gif"},
	".webp": {"image/webp"},
	".pdf":  {"pdf"},
	".txt":  {"text/plain; charset=utf-8"},
	".md":   {"text/plain; charset=utf-8"},
	".csv":  {"text/plain; charset=utf-8"},
	".json": {"text/plain; charset=utf-8", "application/json"},
	".doc":  {"ole2"},
	".docx": {"zip"},
	".docm": {"zip"},
	".ppt":  {"ole2"},
	".pptx": {"zip"},
	".pptm": {"zip"},
	".ppsx": {"zip"},
	".ppsm": {"zip"},
	".xls":  {"ole2"},
	".xlsx": {"zip"},
	".xlsm": {"zip"},
	".odt":  {"zip"},
	".ods":  {"zip"},
	".odp":  {"zip"},
	".rtf":  {"text/plain; charset=utf-8"},
	".epub": {"zip"},
}

// sniffKind identifies the container of a file from its leading bytes: pdf,
// zip (docx/pptx/xlsx/odt/epub), ole2 (doc/ppt/xls), or falls back to
// http.DetectContentType for plain text, images and JSON.
func sniffKind(data []byte) string {
	switch {
	case bytes.HasPrefix(data, []byte("%PDF-")):
		return "pdf"
	case bytes.HasPrefix(data, zipMagic):
		return "zip"
	case bytes.HasPrefix(data, ole2Magic):
		return "ole2"
	}
	return http.DetectContentType(data)
}

// sanitizeAttachmentFilename strips path components and control characters so
// a hostile filename can't traverse directories or inject header bytes.
func sanitizeAttachmentFilename(name string) string {
	name = filepath.Base(strings.ReplaceAll(name, "\\", "/"))
	name = strings.Map(func(r rune) rune {
		if r < 0x20 || r == 0x7f || r == '"' || r == '\\' {
			return '_'
		}
		return r
	}, name)
	if name == "" || name == "." || name == ".." {
		return "file"
	}
	return name
}

// docMediaTypes maps document extensions to their canonical media type,
// stored on the attachment record and reported to the client.
var docMediaTypes = map[string]string{
	".pdf":  "application/pdf",
	".doc":  "application/msword",
	".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
	".docm": "application/vnd.ms-word.document.macroEnabled.12",
	".ppt":  "application/vnd.ms-powerpoint",
	".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
	".pptm": "application/vnd.ms-powerpoint.presentation.macroEnabled.12",
	".ppsx": "application/vnd.openxmlformats-officedocument.presentationml.slideshow",
	".ppsm": "application/vnd.ms-powerpoint.slideshow.macroEnabled.12",
	".xls":  "application/vnd.ms-excel",
	".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
	".xlsm": "application/vnd.ms-excel.sheet.macroEnabled.12",
	".odt":  "application/vnd.oasis.opendocument.text",
	".ods":  "application/vnd.oasis.opendocument.spreadsheet",
	".odp":  "application/vnd.oasis.opendocument.presentation",
	".epub": "application/epub+zip",
}

// validateAttachment checks the filename extension against the whitelist and
// verifies the file's leading bytes match an allowed kind for that extension.
// It returns the media type to store on the attachment record.
func validateAttachment(filename string, data []byte) (mediaType string, ok bool) {
	ext := strings.ToLower(filepath.Ext(filename))
	allowed, known := allowedAttachmentTypes[ext]
	if !known {
		return "", false
	}
	kind := sniffKind(data)
	for _, a := range allowed {
		if kind == a {
			if mt, isDoc := docMediaTypes[ext]; isDoc {
				return mt, true
			}
			return kind, true
		}
	}
	return "", false
}
// handleUploadAttachments accepts a multipart form with up to 3 files under
// the "files" field, each optionally paired with a Markdown conversion in the
// "converted_{i}" field (same index), stores them in PocketBase, and returns
// their metadata.
func (s *Server) handleUploadAttachments(w http.ResponseWriter, r *http.Request) {
	userID, _ := userIDFromContext(r)
	chatID := r.PathValue("id")

	if _, err := s.Store.GetChat(chatID, userID); err != nil {
		errorResponse(w, "Chat not found", http.StatusNotFound)
		return
	}

	r.Body = http.MaxBytesReader(w, r.Body, maxAttachmentsPerRequest*(maxAttachmentBytes+maxConvertedBytes)+(1<<20))
	if err := r.ParseMultipartForm(maxAttachmentsPerRequest * maxAttachmentBytes); err != nil {
		errorResponse(w, "Request too large or invalid multipart body", http.StatusBadRequest)
		return
	}

	files := r.MultipartForm.File["files"]
	if len(files) == 0 {
		files = r.MultipartForm.File["file"]
	}
	if len(files) == 0 || len(files) > maxAttachmentsPerRequest {
		errorResponse(w, "Provide between 1 and 3 files", http.StatusBadRequest)
		return
	}

	uploaded := make([]*store.AttachmentInfo, 0, len(files))
	for i, fh := range files {
		if fh.Size > maxAttachmentBytes {
			errorResponse(w, "File exceeds the 20MB limit: "+fh.Filename, http.StatusBadRequest)
			return
		}

		f, err := fh.Open()
		if err != nil {
			errorResponse(w, "Failed to read file: "+fh.Filename, http.StatusBadRequest)
			return
		}
		data, err := io.ReadAll(io.LimitReader(f, maxAttachmentBytes+1))
		f.Close()
		if err != nil {
			errorResponse(w, "Failed to read file: "+fh.Filename, http.StatusBadRequest)
			return
		}

		mediaType, ok := validateAttachment(fh.Filename, data)
		if !ok {
			errorResponse(w, "File type not allowed: "+sanitizeAttachmentFilename(fh.Filename), http.StatusBadRequest)
			return
		}

		safeName := sanitizeAttachmentFilename(fh.Filename)
		var convertedName string
		var converted []byte
		if vals := r.MultipartForm.Value["converted_"+strconv.Itoa(i)]; len(vals) > 0 && vals[0] != "" {
			if !utf8.ValidString(vals[0]) {
				errorResponse(w, "Converted document is not valid UTF-8: "+safeName, http.StatusBadRequest)
				return
			}
			if len(vals[0]) > maxConvertedBytes {
				errorResponse(w, "Converted document exceeds the 50MB limit: "+safeName, http.StatusBadRequest)
				return
			}
			converted = []byte(vals[0])
			convertedName = safeName + ".md"
		}

		info, err := s.Store.SaveAttachment(chatID, userID, safeName, mediaType, data, convertedName, converted)
		if err != nil {
			internalError(w, r, "Failed to save attachment", err)
			return
		}
		uploaded = append(uploaded, info)
	}

	jsonResponse(w, map[string]any{"attachments": uploaded}, http.StatusOK)
}

// handleGetAttachment serves the raw bytes of an attachment owned by the
// authenticated user.
func (s *Server) handleGetAttachment(w http.ResponseWriter, r *http.Request) {
	userID, _ := userIDFromContext(r)
	attachmentID := r.PathValue("id")

	info, data, err := s.Store.GetAttachmentData(attachmentID, userID)
	if err != nil {
		errorResponse(w, "Attachment not found", http.StatusNotFound)
		return
	}

	mediaType := info.MediaType
	if mediaType == "" {
		mediaType = "application/octet-stream"
	}
	w.Header().Set("Content-Type", mediaType)
	// Only images render inline; anything else downloads as an attachment so
	// e.g. a PDF can't execute script in the app's origin.
	disposition := "attachment"
	if strings.HasPrefix(mediaType, "image/") {
		disposition = "inline"
	}
	w.Header().Set("Content-Disposition", mime.FormatMediaType(disposition, map[string]string{"filename": info.Filename}))
	w.Header().Set("Cache-Control", "private, max-age=3600")
	w.Header().Set("X-Content-Type-Options", "nosniff")
	w.Write(data)
}
