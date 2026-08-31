package migrations

import (
	"strings"

	"github.com/pocketbase/pocketbase/core"
)

func init() {
	core.AppMigrations.Register(func(txApp core.App) error {
		collection, err := txApp.FindCollectionByNameOrId("rp_project")
		if err != nil {
			return nil
		}

		coverField := collection.Fields.GetByName("cover")
		if coverField != nil {
			if fileField, ok := coverField.(*core.FileField); ok {
				fileField.MimeTypes = []string{
					"image/jpeg", "image/png", "image/gif", "image/webp",
				}
				fileField.Thumbs = []string{"160x160", "320x320"}
			}
		}

		if err := txApp.Save(collection); err != nil {
			return err
		}

		records, err := txApp.FindAllRecords("rp_project")
		if err != nil {
			return nil
		}

		for _, record := range records {
			cover := record.GetString("cover")
			if strings.HasSuffix(strings.ToLower(cover), ".svg") {
				record.Set("cover", "")
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
