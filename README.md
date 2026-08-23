# AI Agent UHD — Dictionary AI Agent + Book Chat + Personal Tutor

سيرفر واحد بيعمل ثلاث حاجات:

1. **استخراج المفردات** من كتب إنجليزية مدرسية
2. **شات بوت تعليمي (RAG)** بيجاوب على أي سؤال من محتوى الكتاب المرفوع فقط
3. **شات بوت شخصي (Tutor)** بيعرف تقدم المستخدم لحظيًا (كلمات ضعيفة، إحصائيات، اقتراحات كويز/فلاش كارد) — **بدون أي تخزين لبيانات المستخدم على السيرفر**

---

## المميزات (Book Chat)

- رفع كتاب PDF كامل
- تخزين الكتاب على شكل قطع (chunks)
- البحث عن الأجزاء الأكثر صلة بالسؤال (BM25)
- الإجابة باستخدام LLM (Groq أو Gemini) **فقط من محتوى الكتاب**
- يدعم أسئلة بالعربي والإنجليزي

---

## المميزات (Personal Tutor) — جديد

- يعرف حالة المستخدم من **ملخص لحظي** بيتبعت مع كل طلب (مش بيتخزن)
- الملخص صغير عمدًا (أرقام + عينة ≤20 كلمة ضعيفة) عشان الـ bandwidth يفضل خفيف
- يجاوب على: كام كلمة ذاكرت؟ إيه الضعيف؟ إيه أنصح بيه؟ اعمل كويز...
- لو طلب كويز/فلاش كارد بيرجع `action` جاهز للتطبيق يفتح الشاشة المناسبة
- لو المعلومة مش موجودة في الملخص → يقول بصراحة "مش عندي المعلومة دي"
- يدعم عربي وإنجليزي + تاريخ محادثة قصير (العميل هو اللي بيحتفظ بيه)

---

## Endpoints

| Method | Path | الوصف |
|--------|------|--------|
| GET | `/` | معلومات السيرفر |
| GET | `/health` | فحص الحالة |
| POST | `/extract` | استخراج مفردات من نص |
| POST | `/extract-pdf` | استخراج مفردات من PDF |
| **POST** | **`/upload-book`** | **رفع كتاب كامل للشات** |
| **GET** | **`/books`** | **قائمة الكتب المرفوعة** |
| **GET** | **`/books/{book_id}`** | **تفاصيل كتاب** |
| **DELETE** | **`/books/{book_id}`** | **حذف كتاب** |
| **POST** | **`/chat`** | **اسأل سؤال عن كتاب** |
| **POST** | **`/tutor-chat`** | **شات شخصي عن تقدم المستخدم** |

كل الـ endpoints (ماعدا `/` و `/health`) محتاجة هيدر:
```
X-API-Secret: <قيمة API_SECRET>
```

---

## أمثلة استخدام

### 1. رفع كتاب
```bash
curl -X POST "https://YOUR-SERVER/upload-book" \
  -H "X-API-Secret: your_secret" \
  -F "file=@english_book.pdf" \
  -F "title=English for Secondary 3"
```

الرد:
```json
{
  "success": true,
  "book": {
    "id": "a1b2c3d4e5f6",
    "title": "English for Secondary 3",
    "page_count": 120,
    "chunk_count": 85
  }
}
```

### 2. سؤال الشات (كتاب)
```bash
curl -X POST "https://YOUR-SERVER/chat" \
  -H "X-API-Secret: your_secret" \
  -H "Content-Type: application/json" \
  -d '{
    "book_id": "a1b2c3d4e5f6",
    "question": "اشرح قاعدة present perfect الموجودة في الكتاب"
  }'
```

### 3. الشات الشخصي (Tutor) — ملخص صغير لحظي
```bash
curl -X POST "https://YOUR-SERVER/tutor-chat" \
  -H "X-API-Secret: your_secret" \
  -H "Content-Type: application/json" \
  -d '{
    "question": "إيه الكلمات الضعيفة عليا؟ وأنصحني أعمل إيه",
    "user_context": {
      "name": "أحمد",
      "total_words": 487,
      "mastered": 312,
      "learning": 98,
      "weak": 77,
      "today_studied": 12,
      "streak": 8,
      "level": 14,
      "weak_words": ["abandon", "benevolent", "consequence", "diligent", "elaborate"],
      "recent_words": ["meticulous", "pragmatic"],
      "last_activity": "flashcards - 2 hours ago"
    }
  }'
```

رد تقريبي:
```json
{
  "success": true,
  "answer": "عندك حوالي 77 كلمة ضعيفة. من العينة: abandon, benevolent, ... أنصحك تبدأ بكويز على الضعيف.\n→ ACTION: quiz_weak",
  "action": "quiz_weak",
  "context_used": { "...": "الملخص بعد التنظيف" },
  "message": "Answer generated from live user summary only (nothing stored on server)"
}
```

**قيم `action` المدعومة:**
- `quiz_weak` / `quiz_all`
- `flashcards_weak` / `flashcards_all` / `flashcards_recent`

### 4. قائمة الكتب
```bash
curl -H "X-API-Secret: your_secret" https://YOUR-SERVER/books
```

### شكل `user_context` الموصى به (صغير)
| حقل | معنى | ملاحظات |
|-----|------|---------|
| `total_words` | إجمالي الكلمات | رقم |
| `mastered` | متقنة | رقم |
| `learning` | قيد التعلم | رقم |
| `weak` | عدد الضعيف | رقم |
| `weak_words` | عينة كلمات ضعيفة | **أقصى 20** |
| `recent_words` | كلمات حديثة | **أقصى 10** |
| `today_studied` | ذاكر النهاردة | رقم |
| `streak` | سلسلة الأيام | رقم |
| `level` | المستوى | رقم |
| `last_activity` | آخر نشاط | نص قصير |
| `name` | الاسم | اختياري |

السيرفر **مش بيخزن** أي حاجة من ده. كل طلب مستقل.

---

## الرفع على Render (مجاني)

1. ارفع المجلد ده على GitHub
2. New → Web Service على Render
3. الإعدادات:
   - Build Command: `pip install -r requirements.txt`
   - Start Command: `uvicorn main:app --host 0.0.0.0 --port $PORT`
4. Environment Variables:

| Key | Value |
|-----|-------|
| `LLM_PROVIDER` | `groq` |
| `GROQ_API_KEY` | مفتاحك من console.groq.com |
| `GEMINI_API_KEY` | (اختياري) لو عايز OCR أو fallback |
| `API_SECRET` | نص سري عشوائي |

> ملاحظة: على الخطة المجانية الملفات بتتمسح لما السيرفر ينام. للكتب المهمة استخدم تخزين خارجي لاحقًا (Supabase Storage / S3).

---

## التشغيل المحلي

```bash
pip install -r requirements.txt
cp .env.example .env
# عدّل المفاتيح في .env
python main.py
```

بعدها افتح: http://localhost:8000/docs

---

## الربط مع الفرونت إند (Bacaloria)

تقدر تضيف صفحة شات بسيطة:

1. المستخدم يرفع PDF → تستدعي `/upload-book`
2. تحفظ `book_id` اللي راجع
3. أي سؤال يروح لـ `/chat` مع نفس الـ `book_id`

مثال JavaScript:

```js
// رفع كتاب
const form = new FormData();
form.append("file", pdfFile);
form.append("title", "كتابي");

const uploadRes = await fetch(`${AI_URL}/upload-book`, {
  method: "POST",
  headers: { "X-API-Secret": AI_SECRET },
  body: form,
});
const { book } = await uploadRes.json();

// سؤال
const chatRes = await fetch(`${AI_URL}/chat`, {
  method: "POST",
  headers: {
    "X-API-Secret": AI_SECRET,
    "Content-Type": "application/json",
  },
  body: JSON.stringify({
    book_id: book.id,
    question: "ما معنى كلمة ambition في الكتاب؟",
  }),
});
const { answer } = await chatRes.json();
```

---

## ملاحظات مهمة

- الشات **مش** بيستخدم معرفة النموذج العامة. لو المعلومة مش في الكتاب هيقولك كده.
- الكتب الممسوحة (صور) محتاجة `GEMINI_API_KEY` للـ OCR.
- حجم الملف الأقصى تقريبًا 40 ميجا.
