package migrations

import (
	"github.com/pocketbase/pocketbase/core"
)

func init() {
	core.AppMigrations.Register(func(txApp core.App) error {
		collection, err := txApp.FindCollectionByNameOrId("rp_prototype")
		if err != nil {
			return nil
		}

		field := collection.Fields.GetByName("file")
		if field != nil {
			if fileField, ok := field.(*core.FileField); ok {
				// 支持最大 500MB 原型包上传 (500 * 1024 * 1024)
				fileField.MaxSize = 524288000
				fileField.MimeTypes = []string{
					"application/zip",
					"application/x-zip-compressed",
					"application/octet-stream",
					"application/x-zip",
					"multipart/form-data",
				}
			}
		}

		return txApp.Save(collection)
	}, func(txApp core.App) error {
		return nil
	})
}
