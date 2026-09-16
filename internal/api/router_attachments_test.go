package api

import "testing"

func TestValidateAttachment(t *testing.T) {
	zipMagic := []byte{0x50, 0x4B, 0x03, 0x04, 0x14, 0x00, 0x06, 0x00}
	ole2Magic := []byte{0xD0, 0xCF, 0x11, 0xE0, 0xA1, 0xB1, 0x1A, 0xE1, 0x00, 0x00}

	tests := []struct {
		name      string
		filename  string
		data      []byte
		wantOK    bool
		wantMedia string
	}{
		{"pdf magic", "doc.pdf", []byte("%PDF-1.7\n..."), true, "application/pdf"},
		{"docx is a zip container", "report.docx", zipMagic, true, "application/vnd.openxmlformats-officedocument.wordprocessingml.document"},
		{"pptx is a zip container", "slides.pptx", zipMagic, true, "application/vnd.openxmlformats-officedocument.presentationml.presentation"},
		{"xlsx is a zip container", "sheet.xlsx", zipMagic, true, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"},
		{"odt is a zip container", "text.odt", zipMagic, true, "application/vnd.oasis.opendocument.text"},
		{"epub is a zip container", "book.epub", zipMagic, true, "application/epub+zip"},
		{"legacy doc is ole2", "old.doc", ole2Magic, true, "application/msword"},
		{"legacy xls is ole2", "old.xls", ole2Magic, true, "application/vnd.ms-excel"},
		{"rtf sniffs as text", "note.rtf", []byte(`{\rtf1\ansi hello}`), true, "text/plain; charset=utf-8"},
		{"txt still allowed", "note.txt", []byte("hello"), true, "text/plain; charset=utf-8"},
		{"uppercase extension", "REPORT.PDF", []byte("%PDF-1.7"), true, "application/pdf"},
		{"renamed executable as docx rejected", "evil.docx", []byte{0x4D, 0x5A, 0x90, 0x00}, false, ""},
		{"renamed zip as pdf rejected", "evil.pdf", zipMagic, false, ""},
		{"empty pdf rejected", "doc.pdf", []byte("not a pdf"), false, ""},
		{"disallowed extension", "evil.exe", []byte("%PDF-1.7"), false, ""},
		{"docx with text content rejected", "fake.docx", []byte("plain text"), false, ""},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			media, ok := validateAttachment(tt.filename, tt.data)
			if ok != tt.wantOK {
				t.Fatalf("validateAttachment(%q) ok = %v, want %v", tt.filename, ok, tt.wantOK)
			}
			if ok && media != tt.wantMedia {
				t.Errorf("validateAttachment(%q) media = %q, want %q", tt.filename, media, tt.wantMedia)
			}
		})
	}
}
