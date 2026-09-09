package main

import (
	"testing"
	"time"
)

func TestExtractTimeFromPath(t *testing.T) {
	cases := []struct {
		path     string
		fallback time.Time
		wantYear int
		wantMon  time.Month
	}{
		{
			path:     "2026年9月/扫码点餐v1.02需求",
			fallback: time.Date(2025, 3, 10, 10, 0, 0, 0, time.UTC),
			wantYear: 2026,
			wantMon:  time.September,
		},
		{
			path:     "2026年9月/存量设备升级-美团单链需求",
			fallback: time.Date(2025, 1, 5, 8, 0, 0, 0, time.UTC),
			wantYear: 2026,
			wantMon:  time.September,
		},
		{
			path:     "2026年8月/某需求",
			fallback: time.Date(2025, 5, 20, 12, 0, 0, 0, time.UTC),
			wantYear: 2026,
			wantMon:  time.August,
		},
		{
			path:     "2026年6月/漏单获取需求",
			fallback: time.Date(2026, 6, 25, 14, 0, 0, 0, time.UTC),
			wantYear: 2026,
			wantMon:  time.June,
		},
		{
			path:     "2026年6月/多功能一体机支持付款码支付和接入海科支付通道需求",
			fallback: time.Date(2026, 6, 10, 9, 0, 0, 0, time.UTC),
			wantYear: 2026,
			wantMon:  time.June,
		},
		{
			path:     "2026年4月/京东团购适配改造需求",
			fallback: time.Date(2026, 4, 15, 11, 0, 0, 0, time.UTC),
			wantYear: 2026,
			wantMon:  time.April,
		},
	}

	for _, c := range cases {
		got := extractTimeFromPath(c.path, c.fallback)
		if got.Year() != c.wantYear || got.Month() != c.wantMon {
			t.Errorf("extractTimeFromPath(%q) = %v; want %d-%02d", c.path, got, c.wantYear, c.wantMon)
		}
	}

	// Test comparison between 2026年9月, 2026年8月, 2026年6月 (latest first):
	tSep := extractTimeFromPath("2026年9月/存量设备升级-美团单链需求", time.Date(2025, 1, 1, 0, 0, 0, 0, time.UTC))
	tAug := extractTimeFromPath("2026年8月/某需求", time.Date(2025, 1, 1, 0, 0, 0, 0, time.UTC))
	tJun25 := extractTimeFromPath("2026年6月/漏单获取需求", time.Date(2026, 6, 25, 14, 0, 0, 0, time.UTC))
	tJun10 := extractTimeFromPath("2026年6月/多功能一体机", time.Date(2026, 6, 10, 9, 0, 0, 0, time.UTC))
	tApr := extractTimeFromPath("2026年4月/京东团购", time.Date(2026, 4, 15, 11, 0, 0, 0, time.UTC))

	if !tSep.After(tAug) {
		t.Errorf("Expected September (%v) to be after August (%v)", tSep, tAug)
	}
	if !tAug.After(tJun25) {
		t.Errorf("Expected August (%v) to be after June 25 (%v)", tAug, tJun25)
	}
	if !tJun25.After(tJun10) {
		t.Errorf("Expected June 25 (%v) to be after June 10 (%v)", tJun25, tJun10)
	}
	if !tJun10.After(tApr) {
		t.Errorf("Expected June 10 (%v) to be after April (%v)", tJun10, tApr)
	}
}
