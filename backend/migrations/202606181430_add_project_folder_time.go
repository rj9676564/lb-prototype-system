package migrations

import (
	"os"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/pocketbase/pocketbase/core"
)

var (
	migReFullDate          = regexp.MustCompile(`(?i)(20\d{2})[-_./年\s](1[0-2]|0?[1-9])[-_./月\s](3[01]|[12]\d|0?[1-9])[日号\s]?`)
	migReCompact8Date      = regexp.MustCompile(`(?:^|[^\d])(20\d{2})(1[0-2]|0[1-9])(3[01]|[12]\d|0[1-9])(?:[^\d]|$)`)
	migReYearMonth         = regexp.MustCompile(`(?i)(20\d{2})[-_./年\s](1[0-2]|0?[1-9])(?:月)?`)
	migReCompact6YearMonth = regexp.MustCompile(`(?:^|[^\d])(20\d{2})(1[0-2]|0[1-9])(?:[^\d]|$)`)
	migReMonthDay          = regexp.MustCompile(`(?i)(?:^|[^v\d])(1[0-2]|0?[1-9])[-_./月\s](3[01]|[12]\d|0?[1-9])[日号\s]?`)
	migReDay               = regexp.MustCompile(`(?:^|[^\d])(3[01]|[12]\d|0?[1-9])[日号]`)
	migReMonthOnly         = regexp.MustCompile(`(?:^|[^\d])(1[0-2]|0?[1-9])月`)
	migReYearOnly          = regexp.MustCompile(`(?i)(20\d{2})年`)
)

func migExtractTimeFromPath(relPath string, fallback time.Time) time.Time {
	normPath := filepath.ToSlash(relPath)
	var year, month, day int

	if m := migReFullDate.FindStringSubmatch(normPath); len(m) == 4 {
		year, _ = strconv.Atoi(m[1])
		month, _ = strconv.Atoi(m[2])
		day, _ = strconv.Atoi(m[3])
	} else if m := migReCompact8Date.FindStringSubmatch(normPath); len(m) == 4 {
		year, _ = strconv.Atoi(m[1])
		month, _ = strconv.Atoi(m[2])
		day, _ = strconv.Atoi(m[3])
	} else {
		if m := migReYearMonth.FindStringSubmatch(normPath); len(m) == 3 {
			year, _ = strconv.Atoi(m[1])
			month, _ = strconv.Atoi(m[2])
		} else if m := migReCompact6YearMonth.FindStringSubmatch(normPath); len(m) == 3 {
			year, _ = strconv.Atoi(m[1])
			month, _ = strconv.Atoi(m[2])
		} else if m := migReYearOnly.FindStringSubmatch(normPath); len(m) == 2 {
			year, _ = strconv.Atoi(m[1])
		}

		if m := migReMonthDay.FindStringSubmatch(normPath); len(m) == 3 {
			if month == 0 {
				month, _ = strconv.Atoi(m[1])
			}
			day, _ = strconv.Atoi(m[2])
		} else if m := migReDay.FindStringSubmatch(normPath); len(m) == 2 {
			day, _ = strconv.Atoi(m[1])
		} else if month == 0 {
			if m := migReMonthOnly.FindStringSubmatch(normPath); len(m) == 2 {
				month, _ = strconv.Atoi(m[1])
			}
		}
	}

	if year == 0 && month == 0 && day == 0 {
		if fallback.IsZero() {
			return time.Now()
		}
		return fallback
	}

	refTime := fallback
	if refTime.IsZero() {
		refTime = time.Now()
	}

	if year == 0 {
		year = refTime.Year()
	}
	if month == 0 {
		month = int(refTime.Month())
	}

	if day == 0 {
		maxDays := time.Date(year, time.Month(month)+1, 0, 0, 0, 0, 0, time.UTC).Day()
		d := refTime.Day()
		if d > maxDays {
			d = maxDays
		}
		if d < 1 {
			d = 1
		}
		day = d
	}

	hour, min, sec := refTime.Hour(), refTime.Minute(), refTime.Second()
	nsec := refTime.Nanosecond()

	return time.Date(year, time.Month(month), day, hour, min, sec, nsec, time.UTC)
}

func init() {
	core.AppMigrations.Register(func(txApp core.App) error {
		collection, err := txApp.FindCollectionByNameOrId("rp_project")
		if err != nil {
			return nil
		}

		if collection.Fields.GetByName("folder_time") == nil {
			collection.Fields.Add(&core.DateField{
				Name: "folder_time",
			})
		}

		if err := txApp.Save(collection); err != nil {
			return err
		}

		records, err := txApp.FindAllRecords("rp_project")
		if err != nil {
			return nil
		}

		sourceDir := strings.TrimSpace(os.Getenv("PROTOTYPE_SOURCE_DIR"))

		for _, record := range records {
			desc := record.GetString("description")
			var setTime bool
			if strings.HasPrefix(desc, "[AUTO_SOURCE] ") {
				relPath := strings.TrimPrefix(desc, "[AUTO_SOURCE] ")
				var fsModTime time.Time
				if sourceDir != "" {
					projectDir := filepath.Join(sourceDir, filepath.FromSlash(relPath))
					if info, err := os.Stat(projectDir); err == nil {
						fsModTime = info.ModTime()
						if entries, err := os.ReadDir(projectDir); err == nil {
							for _, entry := range entries {
								if strings.HasPrefix(entry.Name(), ".") {
									continue
								}
								if entryInfo, err := entry.Info(); err == nil && entryInfo.ModTime().After(fsModTime) {
									fsModTime = entryInfo.ModTime()
								}
							}
						}
					}
				}
				if fsModTime.IsZero() {
					created := record.GetDateTime("created")
					if !created.IsZero() {
						fsModTime = created.Time()
					} else {
						fsModTime = record.GetDateTime("updated").Time()
					}
				}
				t := migExtractTimeFromPath(relPath, fsModTime)
				record.Set("folder_time", t)
				setTime = true
			}

			if !setTime && record.GetDateTime("folder_time").IsZero() {
				created := record.GetDateTime("created")
				if !created.IsZero() {
					record.Set("folder_time", created.Time())
				} else {
					record.Set("folder_time", record.GetDateTime("updated").Time())
				}
			}

			if err := txApp.Save(record); err != nil {
				return err
			}
		}

		return nil
	}, func(txApp core.App) error {
		return nil
	})
}
