package api

import (
	"io/fs"
	"net/http"
	"os"
	"path"
	"strings"

	keryxserver "keryx-server"
)

// StaticHandler serves the embedded frontend SPA.
func StaticHandler(staticDir string) http.HandlerFunc {
	var fsys fs.FS
	if staticDir != "" {
		fsys = os.DirFS(staticDir)
	} else {
		sub, err := fs.Sub(keryxserver.FrontendFS, "frontend/dist")
		if err != nil {
			panic(err)
		}
		fsys = sub
	}

	return func(w http.ResponseWriter, r *http.Request) {
		filename := strings.TrimPrefix(r.URL.Path, "/")
		filename = path.Clean(filename)
		if filename == "" || filename == "." || filename == "/" {
			filename = "index.html"
		}

		// Check if the file exists
		if ext := path.Ext(filename); ext != "" {
			f, err := fs.Stat(fsys, filename)
			if err == nil && !f.IsDir() {
				if strings.HasSuffix(filename, ".js") || strings.HasSuffix(filename, ".css") {
					w.Header().Set("Cache-Control", "public, max-age=31536000, immutable")
				}
				http.ServeFileFS(w, r, fsys, filename)
				return
			}
		}

		// SPA fallback: serve index.html
		http.ServeFileFS(w, r, fsys, "index.html")
	}
}
