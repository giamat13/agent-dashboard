# Agent Dashboard

לוח בקרה חי ב-VS Code עבור Claude Code: משימות (TODO), הקשר (זיכרון השיחה), וסקריפטים ארוכים עם שלבים, תת-שלבים וזמן משוער, בשפה פשוטה.

שני חלקים שעובדים דרך קובץ משותף `.agent-dashboard/state.json` בתיקיית הפרויקט:

- `claude-plugin/` — תוסף Claude: hooks שמסנכרנים TODO והקשר, ומזכירים ל-Claude לדווח שלבים וזמן משוער; כלי `dash.js` לדיווח; skill שמסביר איך.
- `vscode-extension/` — תוסף VS Code: לוח בקרה בסרגל הצד, חלון גדול, ושורת סטטוס.

## התקנה

תוסף VS Code: מורידים את `agent-dashboard-<גרסה>.vsix` מעמוד ה-Releases של הריפו ומתקינים:

```
code --install-extension agent-dashboard-<גרסה>.vsix --force
```

ואז Reload Window.

תוסף Claude:

```
/plugin marketplace add GIAMAT13/agent-dashboard
/plugin install agent-dashboard@agent-dashboard
```

(עותק מקומי בפיתוח: `/plugin marketplace add <נתיב לתיקייה הזו>`, או `claude --plugin-dir <נתיב>\claude-plugin`.)

## עדכונים

- התוסף של VS Code בודק עדכונים ב-GitHub Releases כ-20 שניות אחרי הפתיחה ואז כל שעה, בודק את ה-checksum ומתקין. אחרי עדכון: Reload Window. בדיקה ידנית: `Agent Dashboard: Check for updates`.
- תוסף Claude מתעדכן פעם ביום ברקע. השיחה הבאה אחרי עדכון מודיעה על כך; צריך להפעיל מחדש את Claude Code.
- מתגים (כרטיס ההגדרות, גלגל השיניים, או `~/.agent-dashboard/settings.json`): `extensionAutoUpdate`, `pluginAutoUpdate`, `githubActions`, `localApi`.

## מה רואים

- סקריפט/משימה ארוכה: כותרת והסבר פשוט, אחוז התקדמות, שלבים ותתי-שלבים, "מה קורה עכשיו", זמן משוער שנותר, ואזהרה אם אין עדכון (ייתכן שתקוע).
- TODO של Claude (מסתנכרן אוטומטית).
- הקשר: כמה מהזיכרון של Claude בשיחה מלא.

## איך Claude מדווח

ה-hook מזריק ל-Claude הוראות בתחילת שיחה, ומזכיר לעדכן (`eta`, `now`, `sub done`) כשהוא מריץ משהו ארוך או כשעבר זמן בלי עדכון. פקודות: `run start|done|fail`, `step start|done|fail`, `sub add|start|done`, `eta`, `now`, `log`, `status`, `clear`.

## API מקומי ו-GitHub

- `dash.js status` מציג את הכתובת של ה-API המקומי: 127.0.0.1 בלבד, לקריאה בלבד. הכתובת נשמרת ב-`.agent-dashboard/api.json`.
- כרטיס GitHub Actions מציג את ההרצות האחרונות של הריפו (דורש `gh` מחובר). `dash.js ci-eta "<workflow>" <זמן>` קובע זמן משוער ל-workflow מסוים.

## הגדרות

- `agentDashboard.staleMinutes` (ברירת מחדל 3): אחרי כמה דקות בלי עדכון מוצגת אזהרה.
- משתנה סביבה `AGENT_DASH_CONTEXT_MAX`: גודל חלון ההקשר בטוקנים (ברירת מחדל: 200000, או 1000000 למודל 1M).

MIT © GIAMAT13

## Install with Claude

Ask Claude Code: "Install Agent Dashboard following INSTALL-FOR-CLAUDE.md". See [INSTALL-FOR-CLAUDE.md](INSTALL-FOR-CLAUDE.md).
