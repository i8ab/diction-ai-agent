# Dictionary AI Agent

سيرفر منفصل لاستخراج المفردات من الكتب الإنجليزية المدرسية ورفعها في القاموس.

## المميزات

- يستخرج الكلمات المهمة فقط (مش كل كلمة)
- يجيب المعنى العربي (من السياق أو من معرفة النموذج)
- المرادفات والأضداد **فقط** لو موجودة جوه النص
- بيدعم رفع PDF مباشرة
- بيرجع البيانات بنفس شكل القاموس الحالي

---

## الرفع على Render (مجاني)

### 1. ارفع الكود على GitHub

```bash
git init
git add .
git commit -m "AI Agent initial"
# اعمل repo جديد على GitHub وبعدين:
git remote add origin https://github.com/YOUR_USERNAME/diction-ai-agent.git
git push -u origin main
```

### 2. اعمل Web Service على Render

1. روح على https://dashboard.render.com
2. New → Web Service
3. اربط الـ GitHub repo
4. الإعدادات:
   - Name: diction-ai-agent
   - Runtime: Python
   - Build Command: pip install -r requirements.txt
   - Start Command: uvicorn main:app --host 0.0.0.0 --port $PORT
   - Instance Type: Free

### 3. Environment Variables (مهم)

في صفحة الـ Service → Environment أضف:

| Key | Value |
|-----|-------|
| LLM_PROVIDER | groq |
| GROQ_API_KEY | المفتاح بتاعك من Groq |
| GEMINI_API_KEY | المفتاح بتاعك من Gemini (اختياري) |
| API_SECRET | أي نص سري عشوائي |

### 4. بعد الرفع

السيرفر هيبقى على رابط زي:
https://diction-ai-agent.onrender.com

- التوثيق: /docs
- الصحة: /health

ملاحظة: على الخطة المجانية السيرفر بينام بعد 15 دقيقة سكون. أول طلب بعد النوم بياخد 30–60 ثانية.

---

## التشغيل المحلي

```bash
pip install -r requirements.txt
cp .env.example .env
# عدّل المفاتيح في .env
python main.py
```

## Endpoints

| Method | Path | الوصف |
|--------|------|--------|
| GET | / | معلومات السيرفر |
| GET | /health | فحص الحالة |
| POST | /extract | استخراج من نص |
| POST | /extract-pdf | استخراج من PDF |

كل طلبات الاستخراج تحتاج الهيدر:
X-API-Secret: القيمة اللي حاططها في API_SECRET
