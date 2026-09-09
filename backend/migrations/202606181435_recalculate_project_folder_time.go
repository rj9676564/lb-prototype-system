package migrations

import (
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/pocketbase/pocketbase/core"
)

func init() {
	core.AppMigrations.Register(func(txApp core.App) error {
		records, err := txApp.FindAllRecords("rp_project")
		if err != nil {
			return nil
		}

		sourceDir := strings.TrimSpace(os.Getenv("PROTOTYPE_SOURCE_DIR"))

		for _, record := range records {
			desc := record.GetString("description")
			if strings.HasPrefix(desc, "[AUTO_SOURCE] ") {
				relPath := strings.TrimPrefix(desc, "[AUTO_SOURCE] ")
				var fsModTime time.Time
				if sourceDir != "" {
					projectDir := filepath.Join(sourceDir, filepath.FromSlash(relPath))
					if info, err := os.Stat(projectDir); err == nil {
						fsModTime = info.ModTime()
						if entries, err := os.ReadDir(projectDir); err == nil {
							for _, entry := range entries {
								if strings.HasPrefix(entry.Name(), ".") {
									continue
								}
								if entryInfo, err := entry.Info(); err == nil && entryInfo.ModTime().After(fsModTime) {
									fsModTime = entryInfo.ModTime()
								}
							}
						}
					}
				}
				if fsModTime.IsZero() {
					created := record.GetDateTime("created")
					if !created.IsZero() {
						fsModTime = created.Time()
					} else {
						fsModTime = record.GetDateTime("updated").Time()
					}
				}
				t := migExtractTimeFromPath(relPath, fsModTime)
				record.Set("folder_time", t)
				if err := txApp.Save(record); err != nil {
					return err
				}
			} else if record.GetDateTime("folder_time").IsZero() {
				created := record.GetDateTime("created")
				if !created.IsZero() {
					record.Set("folder_time", created.Time())
				} else {
					record.Set("folder_time", record.GetDateTime("updated").Time())
				}
				if err := txApp.Save(record); err != nil {
					return err
				}
			}
		}

		return nil
	}, func(txApp core.App) error {
		return nil
	})
}
