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

		mediaType := fh.Header.Get("Content-Type")
		if mediaType == "" || mediaType == "application/octet-stream" {
			if byExt := mime.TypeByExtension(strings.ToLower(filepath.Ext(fh.Filename))); byExt != "" {
				mediaType = byExt
			}
		}

		info, err := s.Store.SaveAttachment(chatID, userID, fh.Filename, mediaType, data)
		if err != nil {
			errorResponse(w, "Failed to save attachment: "+err.Error(), http.StatusInternalServerError)
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
	w.Header().Set("Content-Disposition", mime.FormatMediaType("inline", map[string]string{"filename": info.Filename}))
	w.Header().Set("Cache-Control", "private, max-age=3600")
	w.Header().Set("X-Content-Type-Options", "nosniff")
	w.Write(data)
}
