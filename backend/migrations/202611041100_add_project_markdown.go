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
		if projectCollection.Fields.GetByName("markdown") == nil {
			projectCollection.Fields.Add(&core.TextField{
				Name: "markdown",
				Max:  2000000,
			})
			return txApp.Save(projectCollection)
		}
		return nil
	}, func(txApp core.App) error {
		return nil
	})
}
