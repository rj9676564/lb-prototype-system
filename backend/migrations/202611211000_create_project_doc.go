package migrations

import (
	"github.com/pocketbase/pocketbase/core"
)

func init() {
	core.AppMigrations.Register(func(txApp core.App) error {
		if _, err := txApp.FindCollectionByNameOrId("rp_project_doc"); err == nil {
			return nil
		}

		projectCollection, err := txApp.FindCollectionByNameOrId("rp_project")
		if err != nil {
			return err
		}

		usersCollection, err := txApp.FindCollectionByNameOrId("users")
		if err != nil {
			return err
		}

		collection := core.NewBaseCollection("rp_project_doc")
		collection.ListRule = stringPtr("")
		collection.ViewRule = stringPtr("")
		collection.CreateRule = stringPtr(anyAuthRule)
		collection.UpdateRule = stringPtr(anyAuthRule)
		collection.DeleteRule = stringPtr("@request.auth.id != \"\" && creator = @request.auth.id")

		collection.Fields.Add(
			&core.RelationField{
				Name:          "project",
				CollectionId:  projectCollection.Id,
				Required:      true,
				MaxSelect:     1,
				CascadeDelete: true,
			},
			&core.TextField{
				Name:     "title",
				Required: true,
				Max:      255,
			},
			&core.SelectField{
				Name:      "doc_type",
				Values:    []string{"api_doc", "env_info", "remark", "other"},
				MaxSelect: 1,
			},
			&core.URLField{
				Name: "external_url",
			},
			&core.TextField{
				Name: "content",
				Max:  2000000,
			},
			&core.FileField{
				Name:      "file",
				MaxSelect: 1,
				MaxSize:   20971520,
			},
			&core.RelationField{
				Name:         "creator",
				CollectionId: usersCollection.Id,
				MaxSelect:    1,
			},
			&core.AutodateField{
				Name:     "created",
				OnCreate: true,
			},
			&core.AutodateField{
				Name:     "updated",
				OnCreate: true,
				OnUpdate: true,
			},
		)

		return txApp.Save(collection)
	}, func(txApp core.App) error {
		return deleteCollectionIfExists(txApp, "rp_project_doc")
	})
}
