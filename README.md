# Agentic Interviewer

A Groq-powered Python web app for an online interview flow with 4 phases:

1. Select language and interview type (`DSA` or `Aptitude`) and generate 5 questions.
2. Submit answers and get each answer reviewed and scored out of 5.
3. Generate a final evaluation with strengths, improvements, and recommendation.
4. End the interview and reset the app.

## Setup

```bash
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
```

Create a `.env` file or set environment variables:

```env
GROQ_API_KEY=your_groq_api_key_here
GROQ_MODEL=llama-3.3-70b-versatile
```

## Run

```bash
python app.py
```

Open [http://127.0.0.1:5000](http://127.0.0.1:5000)

## Notes

- Change `GROQ_MODEL` to any Groq-supported model you want to use.
- You can also override the model directly from the frontend before starting an interview.
- The app keeps interview progress in the browser, so no Flask secret key is needed.
- The backend asks Groq for strict JSON in each phase so the UI can render consistently.
