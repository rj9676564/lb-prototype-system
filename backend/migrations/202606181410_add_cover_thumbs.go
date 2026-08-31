package migrations

import (
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
				fileField.Thumbs = []string{"160x160", "320x320"}
			}
		}

		return txApp.Save(collection)
	}, func(txApp core.App) error {
		return nil
	})
}
