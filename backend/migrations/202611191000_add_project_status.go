package migrations

import "github.com/pocketbase/pocketbase/core"

func init() {
	core.AppMigrations.Register(func(txApp core.App) error {
		collection, err := txApp.FindCollectionByNameOrId("rp_project")
		if err != nil {
			return err
		}
		collection.Fields.Add(&core.SelectField{
			Name: "status", Values: []string{"已上线", "未上线"}, MaxSelect: 1,
		})
		if err := txApp.Save(collection); err != nil {
			return err
		}
		_, err = txApp.DB().NewQuery("UPDATE rp_project SET status = '已上线' WHERE status IS NULL OR status = ''").Execute()
		return err
	}, func(txApp core.App) error {
		collection, err := txApp.FindCollectionByNameOrId("rp_project")
		if err != nil {
			return err
		}
		collection.Fields.RemoveByName("status")
		return txApp.Save(collection)
	})
}
