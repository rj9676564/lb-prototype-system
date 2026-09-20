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

	// Test non-dated paths with fallback
	tMES := extractTimeFromPath("MES系统", time.Date(2023, 11, 20, 8, 0, 0, 0, time.UTC))
	if tMES.Year() != 2023 || tMES.Month() != 11 || tMES.Day() != 20 {
		t.Errorf("expected 2023-11-20 for MES系统, got %v", tMES)
	}

	tOld := extractTimeFromPath("2024年5月/旧项目", time.Date(2026, 9, 16, 12, 0, 0, 0, time.UTC))
	if tOld.Year() != 2024 || tOld.Month() != 5 || tOld.Day() != 1 {
		t.Errorf("expected 2024-05-01 for 2024年5月, got %v", tOld)
	}

	// Test 2025年前 vs 2026年10月
	t2025Before := extractTimeFromPath("2025年前历史产品文档/扫码点餐二期", time.Date(2026, 9, 16, 18, 7, 58, 0, time.UTC))
	t2026Oct := extractTimeFromPath("2026年10月/扫码点餐v1.03需求", time.Date(2026, 9, 16, 10, 25, 50, 0, time.UTC))

	if !t2026Oct.After(t2025Before) {
		t.Errorf("Expected 2026年10月 (%v) to be after 2025年前 (%v)", t2026Oct, t2025Before)
	}
}

