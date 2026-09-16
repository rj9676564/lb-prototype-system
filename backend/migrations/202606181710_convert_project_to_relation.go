package migrations

import (
	"github.com/pocketbase/pocketbase/core"
)

func init() {
	core.AppMigrations.Register(func(txApp core.App) error {
		prototypeCollection, err := txApp.FindCollectionByNameOrId("rp_prototype")
		if err != nil {
			return nil
		}

		projectCollection, err := txApp.FindCollectionByNameOrId("rp_project")
		if err != nil {
			return nil
		}

		field := prototypeCollection.Fields.GetByName("project")
		if field != nil {
			if _, isRelation := field.(*core.RelationField); !isRelation {
				// 将 project 字段转换为关联类型 RelationField
				prototypeCollection.Fields.RemoveByName("project")
				prototypeCollection.Fields.Add(&core.RelationField{
					Name:         "project",
					CollectionId: projectCollection.Id,
					MaxSelect:    1,
				})
				return txApp.Save(prototypeCollection)
			}
		} else {
			prototypeCollection.Fields.Add(&core.RelationField{
				Name:         "project",
				CollectionId: projectCollection.Id,
				MaxSelect:    1,
			})
			return txApp.Save(prototypeCollection)
		}

		return nil
	}, func(txApp core.App) error {
		return nil
	})
}
