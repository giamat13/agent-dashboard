# Agent Dashboard

לוח בקרה חי ב-VS Code עבור Claude Code: משימות (TODO), הקשר (זיכרון השיחה), וסקריפטים ארוכים עם שלבים, תת-שלבים וזמן משוער, בשפה פשוטה.

שני חלקים שעובדים דרך קובץ משותף `.agent-dashboard/state.json` בתיקיית הפרויקט:

- `claude-plugin/` — תוסף Claude: hooks שמסנכרנים TODO והקשר, ומזכירים ל-Claude לדווח שלבים וזמן משוער; כלי `dash.js` לדיווח; skill שמסביר איך.
- `vscode-extension/` — תוסף VS Code: לוח בקרה בסרגל הצד, חלון גדול, ושורת סטטוס.

## התקנה

תוסף VS Code (בלי בנייה):

```powershell
Copy-Item -Recurse vscode-extension "$env:USERPROFILE\.vscode\extensions\giamat13.agent-dashboard-0.1.0"
```

ואז Reload Window.

תוסף Claude:

```
/plugin marketplace add <נתיב לתיקייה הזו>
/plugin install agent-dashboard@agent-dashboard
```

(או לבדיקה: `claude --plugin-dir <נתיב>\claude-plugin`)

## מה רואים

- סקריפט/משימה ארוכה: כותרת והסבר פשוט, אחוז התקדמות, שלבים ותתי-שלבים, "מה קורה עכשיו", זמן משוער שנותר, ואזהרה אם אין עדכון (ייתכן שתקוע).
- TODO של Claude (מסתנכרן אוטומטית).
- הקשר: כמה מהזיכרון של Claude בשיחה מלא.

## איך Claude מדווח

ה-hook מזריק ל-Claude הוראות בתחילת שיחה, ומזכיר לעדכן (`eta`, `now`, `sub done`) כשהוא מריץ משהו ארוך או כשעבר זמן בלי עדכון. פקודות: `run start|done|fail`, `step start|done|fail`, `sub add|start|done`, `eta`, `now`, `log`, `status`, `clear`.

## הגדרות

- `agentDashboard.staleMinutes` (ברירת מחדל 3): אחרי כמה דקות בלי עדכון מוצגת אזהרה.
- משתנה סביבה `AGENT_DASH_CONTEXT_MAX`: גודל חלון ההקשר בטוקנים (ברירת מחדל: 200000, או 1000000 למודל 1M).

MIT © GIAMAT13
