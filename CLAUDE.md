# הוראות לפרויקט Agent Dashboard

## הדשבורד חייב לעלות כמה שפחות USAGE

- כל קריאת כלי קוראת מחדש את כל השיחה. לכן אף פעם לא עושים קריאת כלי רק בשביל הדשבורד: פקודת `dash.js` מוצמדת לפקודה שרצה בכל מקרה.
- משימה של 2 צעדים ומעלה: `dash.js todo set` מוצמד לפקודה אמיתית; `todo done <n>` מתחיל לבד את הבא.
- build, בדיקות, התקנה, אריזה: `wrap.js --title "..." -- <cmd>`. בלי דיווח ידני של now/eta/step.
- כל תכונה חדשה שמוסיפה טקסט להקשר של Claude, או גורמת ל-Claude לעשות קריאות נוספות, חייבת מתג בהגדרות (`lib/settings.js` בשני המקומות + שורה ב-`SETTING_ROWS` ב-`media/main.js`), וברירת המחדל כבויה אלא אם היא זולה מאוד.
- לפני שמשפרים את צריכת ה-USAGE: `node claude-plugin/scripts/dash.js insights` (דוח קצר מהיומן המקומי `~/.agent-dashboard/usage-insights.jsonl`).
- טקסטים שמופיעים בדשבורד כתובים באנגלית פשוטה. השיחה עם המשתמש נשארת בעברית.

נתיב הכלים בפרויקט הזה: `c:/Users/thefu/code/agent-dashboard/claude-plugin/scripts/` (`dash.js`, `wrap.js`).
