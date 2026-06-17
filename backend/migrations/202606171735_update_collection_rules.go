package migrations

import (
	"os"
	"strings"

	"github.com/pocketbase/dbx"
	"github.com/pocketbase/pocketbase/core"
)

func init() {
	core.AppMigrations.Register(func(txApp core.App) error {
		if err := upgradeProjectCollection(txApp); err != nil {
			return err
		}

		if err := upgradePrototypeCollection(txApp); err != nil {
			return err
		}

		if err := updateProjectRules(txApp); err != nil {
			return err
		}

		if err := updatePrototypeRules(txApp); err != nil {
			return err
		}

		return nil
	}, func(txApp core.App) error {
		return nil
	})
}

func upgradeProjectCollection(app core.App) error {
	collection, err := app.FindCollectionByNameOrId("rp_project")
	if err != nil {
		return nil
	}

	usersCollection, err := app.FindCollectionByNameOrId("users")
	if err != nil {
		return err
	}

	addFieldIfMissing(collection, &core.FileField{
		Name:      "cover",
		MaxSelect: 1,
		MimeTypes: []string{"image/jpeg", "image/png", "image/svg+xml", "image/gif", "image/webp"},
	})
	addFieldIfMissing(collection, &core.RelationField{
		Name:         "creator",
		CollectionId: usersCollection.Id,
		MaxSelect:    1,
	})

	if err := app.Save(collection); err != nil {
		return err
	}

	defaultUserID, err := findDefaultUserID(app)
	if err != nil {
		return err
	}

	return backfillMissingField(app, "rp_project", "creator", defaultUserID)
}

func upgradePrototypeCollection(app core.App) error {
	collection, err := app.FindCollectionByNameOrId("rp_prototype")
	if err != nil {
		return nil
	}

	usersCollection, err := app.FindCollectionByNameOrId("users")
	if err != nil {
		return err
	}

	projectCollection, err := app.FindCollectionByNameOrId("rp_project")
	if err == nil && collection.Fields.GetByName("project") == nil {
		collection.Fields.Add(&core.RelationField{
			Name:         "project",
			CollectionId: projectCollection.Id,
			MaxSelect:    1,
		})
	}
	addFieldIfMissing(collection, &core.TextField{
		Name: "remark",
		Max:  2000,
	})
	addFieldIfMissing(collection, &core.FileField{
		Name:      "file",
		MaxSelect: 1,
		MimeTypes: []string{"application/zip", "application/x-zip-compressed", "application/octet-stream"},
	})
	addFieldIfMissing(collection, &core.JSONField{
		Name: "diff_result",
	})
	addFieldIfMissing(collection, &core.BoolField{
		Name: "skip_diff_hook",
	})
	addFieldIfMissing(collection, &core.SelectField{
		Name:      "status",
		MaxSelect: 1,
		Values:    []string{"draft", "reviewing", "approved", "rejected"},
	})
	addFieldIfMissing(collection, &core.RelationField{
		Name:         "creator",
		CollectionId: usersCollection.Id,
		MaxSelect:    1,
	})

	if err := app.Save(collection); err != nil {
		return err
	}

	defaultUserID, err := findDefaultUserID(app)
	if err != nil {
		return err
	}

	if err := backfillMissingField(app, "rp_prototype", "creator", defaultUserID); err != nil {
		return err
	}

	return backfillMissingField(app, "rp_prototype", "status", "approved")
}

func updateProjectRules(app core.App) error {
	collection, err := app.FindCollectionByNameOrId("rp_project")
	if err != nil {
		return nil
	}

	collection.ListRule = stringPtr(anyAuthRule)
	collection.ViewRule = stringPtr(anyAuthRule)
	collection.CreateRule = stringPtr(anyAuthRule)
	collection.UpdateRule = stringPtr(ownerOnlyRule)
	collection.DeleteRule = stringPtr(ownerOnlyRule)

	return app.Save(collection)
}

func addFieldIfMissing(collection *core.Collection, field core.Field) {
	if collection.Fields.GetByName(field.GetName()) != nil {
		return
	}

	collection.Fields.Add(field)
}

func findDefaultUserID(app core.App) (string, error) {
	email := strings.TrimSpace(os.Getenv("DEFAULT_ADMIN_EMAIL"))
	if email == "" {
		email = defaultUserEmailValue
	}

	usersCollection, err := app.FindCollectionByNameOrId("users")
	if err != nil {
		return "", err
	}

	user, err := app.FindAuthRecordByEmail(usersCollection, email)
	if err != nil {
		return "", err
	}

	return user.Id, nil
}

func backfillMissingField(app core.App, collectionName string, fieldName string, value any) error {
	records, err := app.FindAllRecords(collectionName, dbx.NewExp(fieldName+" = '' OR "+fieldName+" IS NULL"))
	if err != nil {
		return err
	}

	for _, record := range records {
		record.Set(fieldName, value)
		if err := app.Save(record); err != nil {
			return err
		}
	}

	return nil
}

func updatePrototypeRules(app core.App) error {
	collection, err := app.FindCollectionByNameOrId("rp_prototype")
	if err != nil {
		return nil
	}

	collection.ListRule = stringPtr(prototypeVisibleRule)
	collection.ViewRule = stringPtr(prototypeVisibleRule)
	collection.CreateRule = stringPtr(anyAuthRule)
	collection.UpdateRule = stringPtr(ownerOnlyRule)
	collection.DeleteRule = stringPtr(ownerOnlyRule)

	return app.Save(collection)
}
