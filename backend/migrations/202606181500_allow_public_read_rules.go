package migrations

import (
	"github.com/pocketbase/pocketbase/core"
)

func init() {
	core.AppMigrations.Register(func(txApp core.App) error {
		if usersCollection, err := txApp.FindCollectionByNameOrId("users"); err == nil {
			usersCollection.ListRule = stringPtr("")
			usersCollection.ViewRule = stringPtr("")
			if err := txApp.Save(usersCollection); err != nil {
				return err
			}
		}

		if projectCollection, err := txApp.FindCollectionByNameOrId("rp_project"); err == nil {
			projectCollection.ListRule = stringPtr("")
			projectCollection.ViewRule = stringPtr("")
			if err := txApp.Save(projectCollection); err != nil {
				return err
			}
		}

		if prototypeCollection, err := txApp.FindCollectionByNameOrId("rp_prototype"); err == nil {
			prototypeCollection.ListRule = stringPtr("")
			prototypeCollection.ViewRule = stringPtr("")
			if err := txApp.Save(prototypeCollection); err != nil {
				return err
			}
		}

		return nil
	}, func(txApp core.App) error {
		return nil
	})
}
