package store

import (
	"io"

	"github.com/pocketbase/dbx"
	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tools/filesystem"
)

// AttachmentInfo is the public metadata of a stored attachment.
type AttachmentInfo struct {
	ID        string `json:"id"`
	Filename  string `json:"filename"`
	MediaType string `json:"mediaType"`
	Size      int64  `json:"size"`
}

// SaveAttachment stores a single file in the attachments collection,
// linked to the given chat and owned by the given user.
func (s *Store) SaveAttachment(chatID, ownerID, filename, mediaType string, data []byte) (*AttachmentInfo, error) {
	collection, err := s.App.FindCollectionByNameOrId(AttachmentsCollection)
	if err != nil {
		return nil, err
	}

	file, err := filesystem.NewFileFromBytes(data, filename)
	if err != nil {
		return nil, err
	}

	record := core.NewRecord(collection)
	record.Set("owner", ownerID)
	record.Set("chat", chatID)
	record.Set("filename", filename)
	record.Set("media_type", mediaType)
	record.Set("size", len(data))
	record.Set("file", file)

	if err := s.App.Save(record); err != nil {
		return nil, err
	}

	return attachmentInfoFromRecord(record), nil
}


// GetAttachmentData returns the metadata and raw bytes of an attachment
// owned by the user.
func (s *Store) GetAttachmentData(attachmentID, ownerID string) (*AttachmentInfo, []byte, error) {
	record, err := s.findOwnedAttachment(attachmentID, ownerID)
	if err != nil {
		return nil, nil, err
	}

	fsys, err := s.App.NewFilesystem()
	if err != nil {
		return nil, nil, err
	}
	defer fsys.Close()

	reader, err := fsys.GetReader(record.BaseFilesPath() + "/" + record.GetString("file"))
	if err != nil {
		return nil, nil, err
	}
	defer reader.Close()

	data, err := io.ReadAll(reader)
	if err != nil {
		return nil, nil, err
	}

	return attachmentInfoFromRecord(record), data, nil
}

// DeleteChatAttachments removes all attachments linked to a chat.
// File blobs are removed by PocketBase on record deletion.
func (s *Store) DeleteChatAttachments(chatID, ownerID string) error {
	records, err := s.App.FindRecordsByFilter(
		AttachmentsCollection,
		"chat = {:chat} && owner = {:owner}",
		"",
		500, 0,
		dbx.Params{"chat": chatID, "owner": ownerID},
	)
	if err != nil {
		return err
	}
	for _, r := range records {
		if err := s.App.Delete(r); err != nil {
			return err
		}
	}
	return nil
}

func (s *Store) findOwnedAttachment(attachmentID, ownerID string) (*core.Record, error) {
	record, err := s.App.FindFirstRecordByFilter(
		AttachmentsCollection,
		"id = {:id} && owner = {:owner}",
		dbx.Params{"id": attachmentID, "owner": ownerID},
	)
	if err != nil {
		return nil, ErrNotFound
	}
	return record, nil
}

func attachmentInfoFromRecord(r *core.Record) *AttachmentInfo {
	return &AttachmentInfo{
		ID:        r.Id,
		Filename:  r.GetString("filename"),
		MediaType: r.GetString("media_type"),
		Size:      int64(r.GetInt("size")),
	}
}
