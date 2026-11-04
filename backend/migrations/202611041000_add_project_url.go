package migrations

import (
	"github.com/pocketbase/pocketbase/core"
)

func init() {
	core.AppMigrations.Register(func(txApp core.App) error {
		projectCollection, err := txApp.FindCollectionByNameOrId("rp_project")
		if err != nil {
			return err
		}
		if projectCollection.Fields.GetByName("url") == nil {
			projectCollection.Fields.Add(&core.URLField{
				Name: "url",
			})
			return txApp.Save(projectCollection)
		}
		return nil
	}, func(txApp core.App) error {
		return nil
	})
}
