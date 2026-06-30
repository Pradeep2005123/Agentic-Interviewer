import base64
import json
import os
import secrets
from typing import Any

from flask import Flask, jsonify, render_template, request, session, url_for
from werkzeug.security import check_password_hash, generate_password_hash
from werkzeug.utils import secure_filename

try:
    from dotenv import load_dotenv
except ImportError:
    def load_dotenv() -> None:
        return None

from groq import AuthenticationError, Groq


load_dotenv()

app = Flask(__name__)
app.secret_key = os.getenv("FLASK_SECRET_KEY", "change-me-in-production")

INTERVIEW_TYPES = {"dsa", "aptitude", "debugging", "scenario"}
RESUME_EXTENSIONS = {"pdf", "docx", "txt", "png", "jpg", "jpeg", "webp"}
IMAGE_RESUME_EXTENSIONS = {"png", "jpg", "jpeg", "webp"}
MIN_RESUME_TEXT_LENGTH = 20
SCENARIO_CATEGORIES = {
    "app-development",
    "website-development",
    "api-development",
    "team-management",
    "data-recovery",
    "product-prioritization",
}
REPORT_STORE: dict[str, dict[str, Any]] = {}
USER_STORE_PATH = os.path.join(app.root_path, "users.json")
PROCTORING_UPLOAD_DIR = os.path.join(app.root_path, "proctoring_uploads")


def load_user_store() -> dict[str, dict[str, str]]:
    if not os.path.exists(USER_STORE_PATH):
        return {}
    try:
        with open(USER_STORE_PATH, "r", encoding="utf-8") as file:
            data = json.load(file)
        return data if isinstance(data, dict) else {}
    except (OSError, json.JSONDecodeError):
        return {}


def save_user_store() -> None:
    with open(USER_STORE_PATH, "w", encoding="utf-8") as file:
        json.dump(USER_STORE, file, indent=2)


USER_STORE: dict[str, dict[str, str]] = load_user_store()


class GroqConfigurationError(RuntimeError):
    """Raised when the local Groq credentials or model settings need attention."""


def get_current_user() -> str:
    return session.get("user_email", "")


def is_logged_in() -> bool:
    return bool(get_current_user())


def require_login_response():
    if not is_logged_in():
        return jsonify({"error": "Please login or register before starting the interview."}), 401
    return None


def get_groq_client() -> Groq:
    api_key = (os.getenv("GROQ_API_KEY") or "").strip()
    if not api_key:
        raise GroqConfigurationError("GROQ_API_KEY is not configured in the .env file.")
    if api_key == "your_groq_api_key_here":
        raise GroqConfigurationError("GROQ_API_KEY still has the placeholder value in the .env file.")
    if api_key.startswith("sk-"):
        raise GroqConfigurationError(
            "GROQ_API_KEY looks like an OpenAI key. This app uses Groq, so add a valid Groq API key instead."
        )
    return Groq(api_key=api_key)


def parse_model_list(raw_models: str) -> list[str]:
    return [model.strip() for model in raw_models.split(",") if model.strip()]


def get_default_model_name() -> str:
    return os.getenv("GROQ_MODEL", "llama-3.3-70b-versatile")


def get_fallback_model_names() -> list[str]:
    fallback_models = os.getenv(
        "GROQ_FALLBACK_MODELS",
        "llama-3.1-8b-instant,gemma2-9b-it",
    )
    return parse_model_list(fallback_models)


def normalize_model_name(model_name: str) -> str:
    return model_name or get_default_model_name()


def get_transcription_model_name() -> str:
    return os.getenv("GROQ_TRANSCRIPTION_MODEL", "whisper-large-v3-turbo")


def get_translation_model_name() -> str:
    return os.getenv("GROQ_TRANSLATION_MODEL", "llama-3.3-70b-versatile")


def get_vision_model_name() -> str:
    return os.getenv("GROQ_VISION_MODEL", "meta-llama/llama-4-scout-17b-16e-instruct")


def clean_json_response(content: str) -> str:
    cleaned = content.strip()
    if cleaned.startswith("```"):
        cleaned = cleaned.strip("`")
        if cleaned.lower().startswith("json"):
            cleaned = cleaned[4:].strip()
    return cleaned.strip()


def build_model_candidates(model_name: str) -> list[str]:
    candidates: list[str] = []
    for candidate in [normalize_model_name(model_name), *get_fallback_model_names()]:
        if candidate and candidate not in candidates:
            candidates.append(candidate)
    return candidates


def is_model_fallback_error(exc: Exception) -> bool:
    message = str(exc).lower()
    fallback_signals = (
        "rate limit",
        "quota",
        "capacity",
        "too many requests",
        "model_decommissioned",
        "model not found",
        "does not exist",
        "unavailable",
    )
    return any(signal in message for signal in fallback_signals)


def create_chat_completion(**kwargs: Any):
    client = get_groq_client()
    last_error: Exception | None = None
    for model_name in build_model_candidates(str(kwargs.get("model", ""))):
        try:
            return client.chat.completions.create(**{**kwargs, "model": model_name})
        except AuthenticationError as exc:
            raise GroqConfigurationError(
                "Groq rejected the API key. Please update GROQ_API_KEY in the .env file with a valid Groq key, "
                "then restart the Flask app."
            ) from exc
        except Exception as exc:
            last_error = exc
            if not is_model_fallback_error(exc):
                raise
    if last_error is not None:
        raise last_error
    raise ValueError("No Groq model is configured.")


def call_groq_json(system_prompt: str, user_prompt: str, model_name: str) -> Any:
    response = create_chat_completion(
        model=model_name,
        temperature=0.3,
        response_format={"type": "json_object"},
        messages=[
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_prompt},
        ],
    )
    content = response.choices[0].message.content or "{}"
    return json.loads(clean_json_response(content))


def call_groq_text(system_prompt: str, user_prompt: str, model_name: str) -> str:
    response = create_chat_completion(
        model=model_name,
        temperature=0.2,
        messages=[
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_prompt},
        ],
    )
    return (response.choices[0].message.content or "").strip()


def normalize_question_list(raw_questions: Any, prefix: str = "q") -> list[dict[str, str]]:
    if not isinstance(raw_questions, list):
        return []

    normalized: list[dict[str, str]] = []
    for index, item in enumerate(raw_questions, start=1):
        question_id = f"{prefix}{index}"
        question_text = ""

        if isinstance(item, str):
            question_text = item.strip()
        elif isinstance(item, dict):
            question_id = str(item.get("id") or question_id).strip() or question_id
            question_text = str(
                item.get("question")
                or item.get("text")
                or item.get("prompt")
                or item.get("content")
                or ""
            ).strip()

        if question_text:
            normalized.append({"id": question_id, "question": question_text})

    return normalized[:5]


def call_groq_vision_resume(image_data_urls: list[str]) -> str:
    client = get_groq_client()
    content: list[dict[str, Any]] = [
        {
            "type": "text",
            "text": (
                "Extract all readable resume text from these resume image/page screenshots. "
                "Preserve candidate name, contact details, skills, education, experience, projects, and certifications. "
                "Return only plain text. If a section is not readable, skip it."
            ),
        }
    ]
    for image_data_url in image_data_urls:
        content.append({"type": "image_url", "image_url": {"url": image_data_url}})

    try:
        response = client.chat.completions.create(
            model=get_vision_model_name(),
            temperature=0.0,
            messages=[
                {
                    "role": "system",
                    "content": "You are an OCR assistant that extracts text from resume images.",
                },
                {"role": "user", "content": content},
            ],
        )
    except AuthenticationError as exc:
        raise GroqConfigurationError(
            "Groq rejected the API key. Please update GROQ_API_KEY in the .env file with a valid Groq key, "
            "then restart the Flask app."
        ) from exc
    return (response.choices[0].message.content or "").strip()


def translate_to_english(text: str, spoken_language: str) -> str:
    if not text.strip() or spoken_language == "en":
        return text.strip()

    system_prompt = (
        "You are a translation assistant for interview answers. Translate the user's response into clear, "
        "natural English while preserving the original meaning, tone, and technical details. "
        "Return only the translated English text with no notes or extra formatting."
    )
    user_prompt = (
        f"Source language code: {spoken_language}\n"
        f"Text to translate:\n{text}"
    )
    return call_groq_text(system_prompt, user_prompt, get_translation_model_name())


def get_file_extension(filename: str) -> str:
    return filename.rsplit(".", 1)[-1].lower() if "." in filename else ""


def bytes_to_data_url(content: bytes, extension: str) -> str:
    mime_type = "image/jpeg" if extension in {"jpg", "jpeg"} else f"image/{extension}"
    encoded = base64.b64encode(content).decode("ascii")
    return f"data:{mime_type};base64,{encoded}"


def extract_image_resume_text(content: bytes, extension: str) -> str:
    return call_groq_vision_resume([bytes_to_data_url(content, extension)])


def extract_pdf_with_vision(content: bytes) -> str:
    try:
        import fitz
    except ImportError as exc:
        raise ValueError("This PDF looks image-based. Install PyMuPDF with pip install -r requirements.txt, then upload again.") from exc

    image_urls: list[str] = []
    with fitz.open(stream=content, filetype="pdf") as document:
        for page_index in range(min(3, len(document))):
            page = document[page_index]
            pixmap = page.get_pixmap(matrix=fitz.Matrix(2, 2), alpha=False)
            image_bytes = pixmap.tobytes("png")
            image_urls.append(bytes_to_data_url(image_bytes, "png"))

    if not image_urls:
        return ""
    return call_groq_vision_resume(image_urls)


def extract_resume_text(uploaded_file: Any) -> str:
    filename = secure_filename(uploaded_file.filename or "")
    extension = get_file_extension(filename)
    content = uploaded_file.read()

    if extension not in RESUME_EXTENSIONS:
        raise ValueError("Please upload a PDF, DOCX, TXT, PNG, JPG, JPEG, or WEBP resume.")
    if not content:
        raise ValueError("The uploaded resume is empty.")

    if extension in IMAGE_RESUME_EXTENSIONS:
        return extract_image_resume_text(content, extension)

    if extension == "txt":
        return content.decode("utf-8", errors="ignore").strip()

    if extension == "pdf":
        try:
            from io import BytesIO
            from pypdf import PdfReader
        except ImportError as exc:
            raise ValueError("PDF resume support is not installed. Run pip install -r requirements.txt.") from exc

        reader = PdfReader(BytesIO(content))
        text_parts = []
        for page in reader.pages:
            page_text = page.extract_text() or ""
            if len(page_text.strip()) < MIN_RESUME_TEXT_LENGTH:
                try:
                    page_text = page.extract_text(extraction_mode="layout") or page_text
                except TypeError:
                    pass
            text_parts.append(page_text)
        extracted_text = "\n".join(text_parts).strip()
        if len(extracted_text) >= MIN_RESUME_TEXT_LENGTH:
            return extracted_text
        return extract_pdf_with_vision(content)

    try:
        from io import BytesIO
        from docx import Document

        document = Document(BytesIO(content))
        return "\n".join(paragraph.text for paragraph in document.paragraphs).strip()
    except ImportError as exc:
        raise ValueError("DOCX resume support is not installed. Run pip install -r requirements.txt.") from exc


def analyze_resume(resume_text: str, model_name: str) -> dict[str, Any]:
    system_prompt = (
        "You are an interview intake assistant. Read the candidate resume and return valid JSON with this shape: "
        '{"candidate_name":"...","primary_language":"...","role_focus":"...",'
        '"skills":["..."],"experience_summary":"..."} . '
        "Choose the primary_language from the strongest programming language or technical stack in the resume. "
        "If the resume is non-technical, set primary_language to General Technical Skills. Keep values concise."
    )
    user_prompt = f"Resume text:\n{resume_text[:6000]}"
    return call_groq_json(system_prompt, user_prompt, model_name)


def generate_questions(
    language: str,
    interview_type: str,
    model_name: str,
    scenario_category: str = "",
    scenario_context: str = "",
    resume_profile: dict[str, Any] | None = None,
) -> list[dict[str, str]]:
    system_prompt = (
        "You are an expert technical interviewer. "
        "Return valid JSON with this shape: "
        '{"questions":[{"id":"q1","question":"..."}]}. '
        "Generate exactly 5 concise but high-quality interview questions. "
        "If the interview type is aptitude, focus on problem-solving, logical reasoning, "
        "quantitative aptitude, and analytical thinking. "
        "If the interview type is dsa, focus on data structures and algorithms in the selected language. "
        "If the interview type is debugging, focus on finding bugs, reading broken code mentally, "
        "troubleshooting, edge cases, and practical reasoning in the selected language. "
        "If the interview type is scenario, generate practical context-based interview questions based on the "
        "provided category and scenario context. Focus on diagnosis, tradeoffs, prioritization, communication, "
        "and decision-making. "
        "If a resume profile is provided, tailor questions to the candidate's listed skills, projects, and role focus. "
        "Do not include explanations or answers."
    )
    user_prompt = (
        f"Interview focus: {language}\n"
        f"Interview type: {interview_type}\n"
        f"Scenario category: {scenario_category}\n"
        f"Scenario context: {scenario_context}\n"
        f"Resume profile: {json.dumps(resume_profile or {}, indent=2)}\n"
        "Generate exactly 5 questions."
    )
    data = call_groq_json(system_prompt, user_prompt, model_name)
    return normalize_question_list(data.get("questions", []), "q")


def generate_hr_followup_questions(
    language: str,
    interview_type: str,
    evaluation: dict[str, Any],
    reviews: list[dict[str, Any]],
    model_name: str,
) -> list[dict[str, str]]:
    system_prompt = (
        "You are an HR interviewer preparing a final HR round after a technical screening. "
        "Return valid JSON with this shape: "
        '{"questions":[{"id":"hr1","question":"..."}]}. '
        "Generate exactly 5 HR questions. Focus on communication, ownership, teamwork, conflict handling, "
        "career motivation, integrity, and professional behavior. Tailor the questions to the candidate's "
        "earlier evaluation strengths and weaknesses. Do not include answers or explanations."
    )
    user_prompt = json.dumps(
        {
            "selected_language": language,
            "technical_round_type": interview_type,
            "technical_evaluation": evaluation,
            "technical_reviews": reviews,
        },
        indent=2,
    )
    data = call_groq_json(system_prompt, user_prompt, model_name)
    return normalize_question_list(data.get("questions", []), "hr")


def score_answers(
    language: str,
    interview_type: str,
    answers: list[dict[str, str]],
    model_name: str,
) -> list[dict[str, Any]]:
    system_prompt = (
        "You are a strict but fair interview evaluator. "
        "Return valid JSON with this shape: "
        '{"results":[{"id":"q1","score":4,"review":"...","strength":"...","improvement":"..."}]}. '
        "Score each answer from 0 to 5 using integers only. "
        "Review should be brief and specific."
    )
    user_prompt = json.dumps(
        {
            "language": language,
            "interview_type": interview_type,
            "answers": answers,
        },
        indent=2,
    )
    data = call_groq_json(system_prompt, user_prompt, model_name)
    return data.get("results", [])


def generate_plagiarism_report(
    language: str,
    interview_type: str,
    answers: list[dict[str, str]],
    model_name: str,
) -> dict[str, Any]:
    system_prompt = (
        "You are an originality and plagiarism risk reviewer for interview answers. "
        "You cannot access the internet or an external plagiarism database, so do not claim a proven plagiarism match. "
        "Return valid JSON with this shape: "
        '{"overall_risk":"LOW","summary":"...",'
        '"results":[{"id":"q1","risk_percent":12,"risk_level":"LOW","reason":"...","originality_tip":"..."}]}. '
        "Estimate whether each answer looks memorized, copied, overly generic, template-like, or inconsistent with a natural interview response. "
        "risk_percent must be an integer from 0 to 100. risk_level must be LOW, MEDIUM, or HIGH."
    )
    user_prompt = json.dumps(
        {
            "language": language,
            "interview_type": interview_type,
            "answers": answers,
        },
        indent=2,
    )
    data = call_groq_json(system_prompt, user_prompt, model_name)
    return {
        "overall_risk": data.get("overall_risk", "LOW"),
        "summary": data.get("summary", "No originality concerns detected."),
        "results": data.get("results", []),
        "note": "AI-based originality risk only; no external plagiarism database was checked.",
    }


def generate_evaluation(
    language: str,
    interview_type: str,
    answers: list[dict[str, str]],
    reviews: list[dict[str, Any]],
    model_name: str,
) -> dict[str, Any]:
    system_prompt = (
        "You are an interview coach. Return valid JSON with this shape: "
        '{"summary":"...","overall_score":18,"rating":"...","strengths":["..."],'
        '"improvements":["..."],"recommendation":"..."} . '
        "overall_score must be out of 25."
    )
    user_prompt = json.dumps(
        {
            "language": language,
            "interview_type": interview_type,
            "answers": answers,
            "reviews": reviews,
        },
        indent=2,
    )
    return call_groq_json(system_prompt, user_prompt, model_name)


def generate_final_outcome(
    language: str,
    interview_type: str,
    technical_answers: list[dict[str, str]],
    technical_reviews: list[dict[str, Any]],
    evaluation: dict[str, Any],
    hr_answers: list[dict[str, str]],
    model_name: str,
) -> dict[str, Any]:
    system_prompt = (
        "You are an interview decision and coaching assistant. Return valid JSON with this shape: "
        '{"status":"PASS","final_summary":"...","decision_reason":"...","readiness":"...",'
        '"topic_corrections":[{"topic":"...","issue":"...","correction":"...","practice":"..."}],'
        '"roadmap":[{"step":"...","title":"...","focus":"...","action":"...","outcome":"..."}]}. '
        "Choose status as PASS or FAIL. Base the decision primarily on the candidate's scores and answer quality. "
        "topic_corrections should contain exactly 2 concise items. Give only practical corrections, not theory lessons. "
        "Each correction should tell the candidate what they did wrong in the interview and what exact action to take next. "
        "roadmap should contain exactly 3 practical steps for future interviews and should read like a short step-by-step action flow."
    )
    user_prompt = json.dumps(
        {
            "language": language,
            "interview_type": interview_type,
            "technical_answers": technical_answers,
            "technical_reviews": technical_reviews,
            "evaluation": evaluation,
            "hr_answers": hr_answers,
        },
        indent=2,
    )
    return call_groq_json(system_prompt, user_prompt, model_name)


def generate_answer_key(
    language: str,
    interview_type: str,
    technical_answers: list[dict[str, str]],
    technical_reviews: list[dict[str, Any]],
    hr_answers: list[dict[str, str]],
    model_name: str,
) -> list[dict[str, Any]]:
    system_prompt = (
        "You are an interview feedback assistant. Return valid JSON with this shape: "
        '{"answer_key":[{"id":"q1","phase":"Technical","question":"...","candidate_answer":"...","expected_answer":"...",'
        '"gap":"...","improvement_tip":"..."}]}. '
        "Generate one entry for every answered question across technical and HR phases. "
        "Use phase values like Technical or HR. expected_answer should be concise and practical, not overly long. "
        "gap should clearly explain what the candidate missed compared to the expected answer. "
        "improvement_tip should be action-oriented."
    )
    user_prompt = json.dumps(
        {
            "language": language,
            "interview_type": interview_type,
            "technical_answers": technical_answers,
            "technical_reviews": technical_reviews,
            "hr_answers": hr_answers,
        },
        indent=2,
    )
    data = call_groq_json(system_prompt, user_prompt, model_name)
    return data.get("answer_key", [])


def reset_interview_state() -> None:
    session["interview"] = {
        "phase": 0,
        "language": "",
        "type": "",
        "model": get_default_model_name(),
        "resume_filename": "",
        "resume_profile": {},
        "scenario_category": "",
        "scenario_context": "",
        "questions": [],
        "answers": [],
        "reviews": [],
        "evaluation": {},
        "plagiarism_report": {},
        "report_link": "",
        "hr_questions": [],
        "hr_answers": [],
        "hr_report_sent": False,
        "final_outcome": {},
        "answer_key": [],
        "proctoring_videos": [],
    }


def create_hr_report_link(interview: dict[str, Any]) -> str:
    token = secrets.token_urlsafe(12)
    interview["report_token"] = token
    REPORT_STORE[token] = {
        "language": interview["language"],
        "type": interview["type"],
        "resume_filename": interview.get("resume_filename", ""),
        "resume_profile": interview.get("resume_profile", {}),
        "scenario_category": interview.get("scenario_category", ""),
        "questions": interview["questions"],
        "answers": interview["answers"],
        "reviews": interview["reviews"],
        "evaluation": interview["evaluation"],
        "plagiarism_report": interview.get("plagiarism_report", {}),
        "final_outcome": interview.get("final_outcome", {}),
        "answer_key": interview.get("answer_key", []),
        "proctoring_videos": interview.get("proctoring_videos", []),
    }
    return url_for("hr_report", report_token=token, _external=True)


def update_existing_hr_report(interview: dict[str, Any]) -> None:
    token = interview.get("report_token")
    if not token or token not in REPORT_STORE:
        return
    REPORT_STORE[token].update(
        {
            "final_outcome": interview.get("final_outcome", {}),
            "answer_key": interview.get("answer_key", []),
            "proctoring_videos": interview.get("proctoring_videos", []),
        }
    )


@app.route("/")
def index():
    if is_logged_in() and "interview" not in session:
        reset_interview_state()
    return render_template(
        "index.html",
        model_name=get_default_model_name(),
        is_authenticated=is_logged_in(),
        username=session.get("user_name", ""),
    )


@app.route("/api/register", methods=["POST"])
def register():
    payload = request.get_json(silent=True) or {}
    name = (payload.get("name") or "").strip()
    email = (payload.get("email") or "").strip().lower()
    password = payload.get("password") or ""

    if not name or not email or not password:
        return jsonify({"error": "Please enter your name, email, and password."}), 400
    if len(password) < 6:
        return jsonify({"error": "Password must be at least 6 characters."}), 400
    if email in USER_STORE:
        return jsonify({"error": "An account already exists with this email. Please login."}), 400

    USER_STORE[email] = {
        "name": name,
        "password_hash": generate_password_hash(password),
    }
    save_user_store()
    session["user_email"] = email
    session["user_name"] = name
    reset_interview_state()
    session.modified = True
    return jsonify({"authenticated": True, "user": {"name": name, "email": email}, "interview": session["interview"]})


@app.route("/api/login", methods=["POST"])
def login():
    payload = request.get_json(silent=True) or {}
    email = (payload.get("email") or "").strip().lower()
    password = payload.get("password") or ""
    user = USER_STORE.get(email)

    if not user or not check_password_hash(user["password_hash"], password):
        return jsonify({"error": "Invalid email or password."}), 401

    session["user_email"] = email
    session["user_name"] = user["name"]
    if "interview" not in session:
        reset_interview_state()
    session.modified = True
    return jsonify({"authenticated": True, "user": {"name": user["name"], "email": email}, "interview": session["interview"]})


@app.route("/api/logout", methods=["POST"])
def logout():
    session.clear()
    return jsonify({"authenticated": False})


@app.route("/api/state", methods=["GET"])
def get_state():
    login_error = require_login_response()
    if login_error:
        return login_error
    if "interview" not in session:
        reset_interview_state()
    return jsonify(session["interview"])


@app.route("/api/start", methods=["POST"])
def start_interview():
    login_error = require_login_response()
    if login_error:
        return login_error
    payload = request.form
    resume_file = request.files.get("resume")
    interview_type = (payload.get("interview_type") or "").strip().lower()
    model_name = normalize_model_name((payload.get("model_name") or get_default_model_name()).strip())
    scenario_category = (payload.get("scenario_category") or "").strip().lower()
    scenario_context = (payload.get("scenario_context") or "").strip()

    if not resume_file or not resume_file.filename:
        return jsonify({"error": "Please upload a resume before starting the interview."}), 400
    if interview_type not in INTERVIEW_TYPES:
        return jsonify({"error": "Please select a valid interview type."}), 400
    if interview_type == "scenario":
        if scenario_category not in SCENARIO_CATEGORIES:
            return jsonify({"error": "Please select a valid scenario category."}), 400
        if not scenario_context:
            return jsonify({"error": "Please provide scenario context."}), 400

    try:
        resume_text = extract_resume_text(resume_file)
    except ValueError as exc:
        return jsonify({"error": str(exc)}), 400

    if len(resume_text) < MIN_RESUME_TEXT_LENGTH:
        return jsonify({"error": "The resume was uploaded, but readable text could not be extracted. Please try a clearer PDF/image, DOCX, or TXT file."}), 400

    try:
        resume_profile = analyze_resume(resume_text, model_name)
        language = (
            resume_profile.get("primary_language")
            or resume_profile.get("role_focus")
            or "Resume Based Technical Skills"
        )
        questions = generate_questions(
            language,
            interview_type,
            model_name,
            scenario_category,
            scenario_context,
            resume_profile,
        )
    except Exception as exc:
        return jsonify({"error": f"Unable to generate questions: {exc}"}), 500

    if len(questions) != 5:
        return jsonify({"error": "The model did not return 5 questions. Please try again."}), 500

    session["interview"] = {
        "phase": 1,
        "language": language,
        "type": interview_type,
        "model": model_name,
        "resume_filename": secure_filename(resume_file.filename),
        "resume_profile": resume_profile,
        "scenario_category": scenario_category,
        "scenario_context": scenario_context,
        "questions": questions,
        "answers": [],
        "reviews": [],
        "evaluation": {},
        "plagiarism_report": {},
        "report_link": "",
        "hr_questions": [],
        "hr_answers": [],
        "hr_report_sent": False,
        "final_outcome": {},
        "answer_key": [],
        "proctoring_videos": [],
    }
    session.modified = True
    return jsonify(session["interview"])


@app.route("/api/upload-proctoring", methods=["POST"])
def upload_proctoring():
    login_error = require_login_response()
    if login_error:
        return login_error

    video_file = request.files.get("video")
    if not video_file or not video_file.filename:
        return jsonify({"error": "No proctoring video was received."}), 400

    os.makedirs(PROCTORING_UPLOAD_DIR, exist_ok=True)
    safe_email = secure_filename(get_current_user().replace("@", "_at_"))
    round_name = secure_filename((request.form.get("round") or "interview").strip().lower())
    reason = secure_filename((request.form.get("reason") or "completed").strip().lower())
    token = secrets.token_urlsafe(8)
    filename = f"{safe_email}_{round_name}_{reason}_{token}.webm"
    save_path = os.path.join(PROCTORING_UPLOAD_DIR, filename)
    video_file.save(save_path)

    if "interview" not in session:
        reset_interview_state()
    interview = session["interview"]
    interview.setdefault("proctoring_videos", []).append(
        {
            "filename": filename,
            "round": round_name,
            "reason": reason,
        }
    )
    session["interview"] = interview
    session.modified = True
    update_existing_hr_report(interview)
    return jsonify({"saved": True, "filename": filename})


@app.route("/api/submit-answers", methods=["POST"])
def submit_answers():
    login_error = require_login_response()
    if login_error:
        return login_error
    if "interview" not in session or session["interview"].get("phase") != 1:
        return jsonify({"error": "Interview is not in question-answer phase."}), 400

    payload = request.get_json(silent=True) or {}
    answers = payload.get("answers") or []
    interview = session["interview"]

    if len(answers) != 5:
        return jsonify({"error": "Exactly 5 answers are required."}), 400

    normalized_answers = []
    for index, item in enumerate(answers):
        answer_text = (item.get("answer") or "").strip()
        question_text = interview["questions"][index]["question"]
        if not answer_text:
            return jsonify({"error": f"Answer {index + 1} is empty."}), 400
        normalized_answers.append(
            {
                "id": interview["questions"][index]["id"],
                "question": question_text,
                "answer": answer_text,
            }
        )

    try:
        reviews = score_answers(
            interview["language"],
            interview["type"],
            normalized_answers,
            interview["model"],
        )
    except Exception as exc:
        return jsonify({"error": f"Unable to review answers: {exc}"}), 500

    try:
        plagiarism_report = generate_plagiarism_report(
            interview["language"],
            interview["type"],
            normalized_answers,
            interview["model"],
        )
    except Exception as exc:
        return jsonify({"error": f"Unable to check originality: {exc}"}), 500

    interview["answers"] = normalized_answers
    interview["reviews"] = reviews
    interview["plagiarism_report"] = plagiarism_report
    interview["phase"] = 2
    session["interview"] = interview
    session.modified = True
    return jsonify(interview)


@app.route("/api/evaluate", methods=["POST"])
def evaluate():
    login_error = require_login_response()
    if login_error:
        return login_error
    if "interview" not in session or session["interview"].get("phase") != 2:
        return jsonify({"error": "Interview is not ready for final evaluation."}), 400

    interview = session["interview"]
    try:
        evaluation = generate_evaluation(
            interview["language"],
            interview["type"],
            interview["answers"],
            interview["reviews"],
            interview["model"],
        )
    except Exception as exc:
        return jsonify({"error": f"Unable to generate evaluation: {exc}"}), 500

    interview["evaluation"] = evaluation
    interview["report_link"] = create_hr_report_link(interview)
    interview["phase"] = 3
    session["interview"] = interview
    session.modified = True
    return jsonify(interview)


@app.route("/api/start-hr-round", methods=["POST"])
def start_hr_round():
    login_error = require_login_response()
    if login_error:
        return login_error
    if "interview" not in session or session["interview"].get("phase") != 3:
        return jsonify({"error": "Final evaluation must be completed before the HR round."}), 400

    interview = session["interview"]
    try:
        hr_questions = generate_hr_followup_questions(
            interview["language"],
            interview["type"],
            interview["evaluation"],
            interview["reviews"],
            interview["model"],
        )
    except Exception as exc:
        return jsonify({"error": f"Unable to prepare HR round: {exc}"}), 500

    if len(hr_questions) != 5:
        return jsonify({"error": "The model did not return 5 HR questions. Please try again."}), 500

    interview["hr_questions"] = hr_questions
    interview["hr_answers"] = []
    interview["hr_report_sent"] = True
    interview["phase"] = 4
    session["interview"] = interview
    session.modified = True
    return jsonify(interview)


@app.route("/api/submit-hr-answers", methods=["POST"])
def submit_hr_answers():
    login_error = require_login_response()
    if login_error:
        return login_error
    if "interview" not in session or session["interview"].get("phase") != 4:
        return jsonify({"error": "HR round is not active."}), 400

    payload = request.get_json(silent=True) or {}
    answers = payload.get("answers") or []
    interview = session["interview"]

    if len(answers) != len(interview.get("hr_questions", [])) or not answers:
        return jsonify({"error": "Please answer all HR questions."}), 400

    normalized_answers = []
    for index, item in enumerate(answers):
        answer_text = (item.get("answer") or "").strip()
        question = interview["hr_questions"][index]
        if not answer_text:
            return jsonify({"error": f"HR answer {index + 1} is empty."}), 400
        normalized_answers.append(
            {
                "id": question["id"],
                "question": question["question"],
                "answer": answer_text,
            }
        )

    interview["hr_answers"] = normalized_answers
    try:
        final_outcome = generate_final_outcome(
            interview["language"],
            interview["type"],
            interview["answers"],
            interview["reviews"],
            interview["evaluation"],
            normalized_answers,
            interview["model"],
        )
    except Exception as exc:
        return jsonify({"error": f"Unable to generate final outcome: {exc}"}), 500

    try:
        answer_key = generate_answer_key(
            interview["language"],
            interview["type"],
            interview["answers"],
            interview["reviews"],
            normalized_answers,
            interview["model"],
        )
    except Exception as exc:
        return jsonify({"error": f"Unable to generate answer comparison: {exc}"}), 500

    interview["final_outcome"] = final_outcome
    interview["answer_key"] = answer_key
    interview["phase"] = 5
    session["interview"] = interview
    session.modified = True
    update_existing_hr_report(interview)
    return jsonify(interview)


@app.route("/api/end", methods=["POST"])
def end_interview():
    login_error = require_login_response()
    if login_error:
        return login_error
    reset_interview_state()
    session.modified = True
    return jsonify(session["interview"])


@app.route("/api/transcribe-audio", methods=["POST"])
def transcribe_audio():
    login_error = require_login_response()
    if login_error:
        return login_error
    audio_file = request.files.get("audio")
    if not audio_file or not audio_file.filename:
        return jsonify({"error": "Please provide an audio file."}), 400

    prompt = (request.form.get("prompt") or "").strip()
    spoken_language = ((request.form.get("spoken_language") or "").strip().lower() or "en")

    transcription_args = {
        "file": (audio_file.filename, audio_file.read()),
        "model": get_transcription_model_name(),
        "response_format": "json",
        "temperature": 0.0,
    }
    if prompt:
        transcription_args["prompt"] = prompt[:600]
    if spoken_language:
        transcription_args["language"] = spoken_language

    try:
        client = get_groq_client()
        try:
            transcription = client.audio.transcriptions.create(**transcription_args)
        except AuthenticationError as exc:
            raise GroqConfigurationError(
                "Groq rejected the API key. Please update GROQ_API_KEY in the .env file with a valid Groq key, "
                "then restart the Flask app."
            ) from exc
    except Exception as exc:
        return jsonify({"error": f"Unable to transcribe audio: {exc}"}), 500

    original_text = getattr(transcription, "text", "") or ""
    if not original_text.strip():
        return jsonify({"error": "No speech was detected in the recording. Please record again a little more clearly."}), 400

    try:
        english_text = translate_to_english(original_text, spoken_language)
    except Exception as exc:
        return jsonify({"error": f"Audio transcribed but translation failed: {exc}"}), 500

    if not english_text.strip():
        return jsonify({"error": "Speech was captured, but no usable text was produced. Please try again."}), 400

    return jsonify(
        {
            "text": english_text,
            "original_text": original_text,
            "transcription_model": get_transcription_model_name(),
            "translation_model": get_translation_model_name() if spoken_language and spoken_language != "en" else "",
            "translated_to_english": spoken_language != "en",
        }
    )


@app.route("/report/<report_token>")
def hr_report(report_token: str):
    report = REPORT_STORE.get(report_token)
    if not report:
        return "Report link is invalid or has expired.", 404
    return render_template("report.html", report=report)


if __name__ == "__main__":
    app.run(debug=True)
