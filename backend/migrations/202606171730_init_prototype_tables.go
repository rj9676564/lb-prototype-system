package migrations

import (
	"os"

	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tools/types"
)

const (
	defaultUserEmailValue    = "admin@example.com"
	defaultUserPasswordValue = "12345678"
	anyAuthRule              = "@request.auth.id != \"\""
	ownerOnlyRule            = "creator = @request.auth.id"
	prototypeVisibleRule     = "creator = @request.auth.id || status = \"approved\""
)

func init() {
	core.AppMigrations.Register(func(txApp core.App) error {
		if err := ensureUsersCollection(txApp); err != nil {
			return err
		}

		if err := ensureProjectCollection(txApp); err != nil {
			return err
		}

		if err := ensurePrototypeCollection(txApp); err != nil {
			return err
		}

		if err := ensureDefaultUser(txApp); err != nil {
			return err
		}

		return nil
	}, func(txApp core.App) error {
		if err := deleteCollectionIfExists(txApp, "rp_prototype"); err != nil {
			return err
		}

		if err := deleteCollectionIfExists(txApp, "rp_project"); err != nil {
			return err
		}

		return nil
	})
}

func ensureUsersCollection(app core.App) error {
	if _, err := app.FindCollectionByNameOrId("users"); err == nil {
		return nil
	}

	users := core.NewAuthCollection("users", "_pb_users_auth_")

	ownerRule := "id = @request.auth.id"
	users.ListRule = stringPtr(ownerRule)
	users.ViewRule = stringPtr(ownerRule)
	users.CreateRule = stringPtr("")
	users.UpdateRule = stringPtr(ownerRule)
	users.DeleteRule = stringPtr(ownerRule)

	users.Fields.Add(
		&core.TextField{
			Name: "name",
			Max:  255,
		},
		&core.FileField{
			Name:      "avatar",
			MaxSelect: 1,
			MimeTypes: []string{"image/jpeg", "image/png", "image/svg+xml", "image/gif", "image/webp"},
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

	users.OAuth2.MappedFields.Name = "name"
	users.OAuth2.MappedFields.AvatarURL = "avatar"

	return app.Save(users)
}

func ensureProjectCollection(app core.App) error {
	if _, err := app.FindCollectionByNameOrId("rp_project"); err == nil {
		return nil
	}

	usersCollection, err := app.FindCollectionByNameOrId("users")
	if err != nil {
		return err
	}

	collection := core.NewBaseCollection("rp_project")
	collection.ListRule = stringPtr(anyAuthRule)
	collection.ViewRule = stringPtr(anyAuthRule)
	collection.CreateRule = stringPtr(anyAuthRule)
	collection.UpdateRule = stringPtr(ownerOnlyRule)
	collection.DeleteRule = stringPtr(ownerOnlyRule)

	collection.Fields.Add(
		&core.TextField{
			Name:     "name",
			Required: true,
			Max:      255,
		},
		&core.TextField{
			Name: "description",
			Max:  2000,
		},
		&core.FileField{
			Name:      "cover",
			MaxSelect: 1,
			MimeTypes: []string{"image/jpeg", "image/png", "image/svg+xml", "image/gif", "image/webp"},
		},
		&core.RelationField{
			Name:         "creator",
			CollectionId: usersCollection.Id,
			Required:     true,
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

	return app.Save(collection)
}

func ensurePrototypeCollection(app core.App) error {
	if _, err := app.FindCollectionByNameOrId("rp_prototype"); err == nil {
		return nil
	}

	projectCollection, err := app.FindCollectionByNameOrId("rp_project")
	if err != nil {
		return err
	}

	usersCollection, err := app.FindCollectionByNameOrId("users")
	if err != nil {
		return err
	}

	collection := core.NewBaseCollection("rp_prototype")
	collection.ListRule = stringPtr(prototypeVisibleRule)
	collection.ViewRule = stringPtr(prototypeVisibleRule)
	collection.CreateRule = stringPtr(anyAuthRule)
	collection.UpdateRule = stringPtr(ownerOnlyRule)
	collection.DeleteRule = stringPtr(ownerOnlyRule)

	collection.Fields.Add(
		&core.RelationField{
			Name:         "project",
			CollectionId: projectCollection.Id,
			Required:     true,
			MaxSelect:    1,
		},
		&core.TextField{
			Name:     "title",
			Required: true,
			Max:      255,
		},
		&core.TextField{
			Name: "remark",
			Max:  2000,
		},
		&core.FileField{
			Name:      "file",
			MaxSelect: 1,
			MimeTypes: []string{"application/zip", "application/x-zip-compressed", "application/octet-stream"},
		},
		&core.TextField{
			Name: "url",
			Max:  2000,
		},
		&core.JSONField{
			Name: "diff_result",
		},
		&core.BoolField{
			Name: "skip_diff_hook",
		},
		&core.SelectField{
			Name:      "status",
			MaxSelect: 1,
			Values:    []string{"draft", "reviewing", "approved", "rejected"},
		},
		&core.RelationField{
			Name:         "creator",
			CollectionId: usersCollection.Id,
			Required:     true,
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

	return app.Save(collection)
}

func deleteCollectionIfExists(app core.App, name string) error {
	collection, err := app.FindCollectionByNameOrId(name)
	if err != nil {
		return nil
	}

	return app.Delete(collection)
}

func stringPtr(value string) *string {
	return &value
}

func ensureDefaultUser(app core.App) error {
	usersCollection, err := app.FindCollectionByNameOrId("users")
	if err != nil {
		return err
	}

	email := os.Getenv("DEFAULT_ADMIN_EMAIL")
	if email == "" {
		email = defaultUserEmailValue
	}

	password := os.Getenv("DEFAULT_ADMIN_PASSWORD")
	if password == "" {
		password = defaultUserPasswordValue
	}

	user, err := app.FindAuthRecordByEmail(usersCollection, email)
	if err != nil {
		user = core.NewRecord(usersCollection)
	}

	user.SetEmail(email)
	user.SetPassword(password)
	user.SetVerified(true)
	user.Set(core.FieldNameEmailVisibility, true)
	user.Set("name", "默认管理员")
	user.Set("created", types.NowDateTime())
	user.Set("updated", types.NowDateTime())

	return app.Save(user)
}
