package migrations

import (
	"strings"

	"github.com/pocketbase/pocketbase/core"
)

func init() {
	core.AppMigrations.Register(func(txApp core.App) error {
		// 1. 给 rp_project 增加 source_type 和 is_auto 字段
		if projectCollection, err := txApp.FindCollectionByNameOrId("rp_project"); err == nil {
			if projectCollection.Fields.GetByName("source_type") == nil {
				projectCollection.Fields.Add(&core.TextField{
					Name: "source_type",
				})
			}
			if projectCollection.Fields.GetByName("is_auto") == nil {
				projectCollection.Fields.Add(&core.BoolField{
					Name: "is_auto",
				})
			}
			if err := txApp.Save(projectCollection); err != nil {
				return err
			}

			// 回填已有数据的 source_type 和 is_auto
			if records, err := txApp.FindAllRecords("rp_project"); err == nil {
				for _, r := range records {
					desc := r.GetString("description")
					if strings.HasPrefix(desc, "[AUTO_SOURCE]") {
						r.Set("source_type", "auto")
						r.Set("is_auto", true)
					} else {
						r.Set("source_type", "manual")
						r.Set("is_auto", false)
					}
					_ = txApp.Save(r)
				}
			}
		}

		// 2. 给 rp_prototype 增加 source_type 和 is_auto 字段
		if prototypeCollection, err := txApp.FindCollectionByNameOrId("rp_prototype"); err == nil {
			if prototypeCollection.Fields.GetByName("source_type") == nil {
				prototypeCollection.Fields.Add(&core.TextField{
					Name: "source_type",
				})
			}
			if prototypeCollection.Fields.GetByName("is_auto") == nil {
				prototypeCollection.Fields.Add(&core.BoolField{
					Name: "is_auto",
				})
			}
			if err := txApp.Save(prototypeCollection); err != nil {
				return err
			}

			// 回填已有数据的 source_type 和 is_auto
			if records, err := txApp.FindAllRecords("rp_prototype"); err == nil {
				for _, r := range records {
					remark := r.GetString("remark")
					if strings.HasPrefix(remark, "[AUTO_SOURCE]") {
						r.Set("source_type", "auto")
						r.Set("is_auto", true)
					} else {
						r.Set("source_type", "manual")
						r.Set("is_auto", false)
					}
					_ = txApp.Save(r)
				}
			}
		}

		return nil
	}, func(txApp core.App) error {
		return nil
	})
}
