package api

import (
	"io"
	"mime"
	"net/http"
	"path/filepath"
	"strings"

	"keryx-server/internal/store"
)

const (
	maxAttachmentsPerRequest = 3
	maxAttachmentBytes       = 20 << 20 // 20 MB per file
)

// allowedAttachmentTypes whitelists uploadable file types. Extensions map to
// the content sniffed from the first bytes of the file (http.DetectContentType),
// so a renamed executable can't pass as a document.
var allowedAttachmentTypes = map[string][]string{
	".png":  {"image/png"},
	".jpg":  {"image/jpeg"},
	".jpeg": {"image/jpeg"},
	".gif":  {"image/gif"},
	".webp": {"image/webp"},
	".pdf":  {"application/pdf"},
	".txt":  {"text/plain; charset=utf-8"},
	".md":   {"text/plain; charset=utf-8"},
	".csv":  {"text/plain; charset=utf-8"},
	".json": {"text/plain; charset=utf-8", "application/json"},
}

// validateAttachment checks the filename extension against the whitelist and
// verifies the file's magic bytes match an allowed type for that extension.
func validateAttachment(filename string, data []byte) (mediaType string, ok bool) {
	ext := strings.ToLower(filepath.Ext(filename))
	allowed, known := allowedAttachmentTypes[ext]
	if !known {
		return "", false
	}
	sniffed := http.DetectContentType(data)
	for _, a := range allowed {
		if sniffed == a {
			return a, true
		}
	}
	return "", false
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

// handleUploadAttachments accepts a multipart form with up to 3 files under
// the "files" field, stores them in PocketBase, and returns their metadata.
func (s *Server) handleUploadAttachments(w http.ResponseWriter, r *http.Request) {
	userID, _ := userIDFromContext(r)
	chatID := r.PathValue("id")

	if _, err := s.Store.GetChat(chatID, userID); err != nil {
		errorResponse(w, "Chat not found", http.StatusNotFound)
		return
	}

	r.Body = http.MaxBytesReader(w, r.Body, maxAttachmentsPerRequest*maxAttachmentBytes+(1<<20))
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
	for _, fh := range files {
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

		info, err := s.Store.SaveAttachment(chatID, userID, sanitizeAttachmentFilename(fh.Filename), mediaType, data)
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
