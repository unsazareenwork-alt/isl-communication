import asyncio
import base64
import json
import os

from datetime import datetime
from collections import deque, Counter

import cv2
import joblib
import mediapipe as mp
import numpy as np

from websockets.asyncio.server import serve

from backend_client import BackendClient


# ============================================================
# CONFIGURATION
# ============================================================

HOST = "0.0.0.0"
PORT = 8765

# ============================================================
# MODEL PATHS
# ============================================================

# ============================================================
# CONFIGURATION
# ============================================================

# Dynamic word model
MODEL_PATH = os.path.abspath(
    os.path.join(
        os.path.dirname(__file__),
        "..",
        "dynamic_model_v4.pkl"
    )
)

CONFIDENCE_THRESHOLD = 0.30
PREDICTION_WINDOW = 3
STABLE_COUNT_REQUIRED = 2
COOLDOWN_FRAMES = 10

# ============================================================
# LOAD V4 MODEL
# ============================================================

print("=" * 60)
print("ISL DYNAMIC AI WEBSOCKET SERVER")
print("=" * 60)

print("\nLoading dynamic V4 model...")
print("Model path:", MODEL_PATH)

if not os.path.exists(MODEL_PATH):
    print("\nERROR: V4 model not found!")
    raise SystemExit(1)


model_data = joblib.load(MODEL_PATH)

model = model_data["model"]
# Use a single worker for real-time inference.
# This avoids unnecessary joblib parallelism for one camera stream.
if hasattr(model, "n_jobs"):
    model.set_params(n_jobs=1)
label_encoder = model_data["label_encoder"]
SEQUENCE_LENGTH = model_data["sequence_length"]
FEATURE_SIZE = model_data["feature_size"]
CLASSES = model_data["classes"]


print("Model loaded successfully.")
print("Sequence length:", SEQUENCE_LENGTH)
print("Feature size:", FEATURE_SIZE)
print("Number of classes:", len(CLASSES))
print("Classes:", CLASSES)


# ============================================================
# MEDIAPIPE
# ============================================================

print("\nInitializing MediaPipe Hands...")

mp_hands = mp.solutions.hands
mp_draw = mp.solutions.drawing_utils

hands = mp_hands.Hands(
    static_image_mode=False,
    max_num_hands=2,
    min_detection_confidence=0.5,
    min_tracking_confidence=0.5
)

print("MediaPipe ready.")


# ============================================================
# BACKEND
# ============================================================

print("\n" + "=" * 60)
print("CONNECTING TO BACKEND")
print("=" * 60)

backend = BackendClient()

if not backend.login():
    print("\nERROR: Backend login failed.")
    hands.close()
    raise SystemExit(1)

print("\nAI backend login successful.")


# ============================================================
# NORMALIZE HAND
# ============================================================

def normalize_hand(landmarks):

    points = np.array(
        [
            [lm.x, lm.y, lm.z]
            for lm in landmarks
        ],
        dtype=np.float32
    )

    wrist = points[0].copy()

    points = points - wrist

    scale = np.max(
        np.linalg.norm(
            points,
            axis=1
        )
    )

    if scale > 0:
        points = points / scale

    return points.flatten()


# ============================================================
# EXTRACT FRAME FEATURES
# ============================================================

def extract_frame_landmarks(frame):

    rgb = cv2.cvtColor(
        frame,
        cv2.COLOR_BGR2RGB
    )

    result = hands.process(rgb)

    features = np.zeros(
        FEATURE_SIZE,
        dtype=np.float32
    )

    if not result.multi_hand_landmarks:
        return features, False, result

    detected = {}

    if result.multi_handedness:

        for i, handedness in enumerate(
            result.multi_handedness
        ):

            label = (
                handedness
                .classification[0]
                .label
            )

            if label in ["Left", "Right"]:
                detected[label] = i

    # Left hand = first 63 features
    # Right hand = next 63 features

    for side, start in [
        ("Left", 0),
        ("Right", 63)
    ]:

        if side in detected:

            index = detected[side]

            hand_landmarks = (
                result
                .multi_hand_landmarks[index]
            )

            hand_features = normalize_hand(
                hand_landmarks.landmark
            )

            features[
                start:start + 63
            ] = hand_features

    return features, True, result

# ============================================================
# FILL MISSING FRAMES
# ============================================================

def fill_missing_frames(
    sequence,
    detected
):

    sequence = np.asarray(
        sequence,
        dtype=np.float32
    )

    detected = np.asarray(
        detected,
        dtype=bool
    )

    if detected.all():
        return sequence

    detected_indices = np.where(
        detected
    )[0]

    if len(detected_indices) == 0:
        return sequence

    for i in range(
        len(sequence)
    ):

        if detected[i]:
            continue

        distances = np.abs(
            detected_indices - i
        )

        nearest = detected_indices[
            np.argmin(distances)
        ]

        sequence[i] = sequence[
            nearest
        ]

    return sequence


# ============================================================
# CREATE NEW AI SESSION STATE
# ============================================================

def create_session():

    return {
        "meeting_id": None,

        "mode": "word",

        "sequence_buffer": deque(
            maxlen=SEQUENCE_LENGTH
        ),

        "detection_buffer": deque(
            maxlen=SEQUENCE_LENGTH
        ),

        "prediction_buffer": deque(
            maxlen=PREDICTION_WINDOW
        ),

        "stable_prediction": None,

        "stable_count": 0,

        "accepted_sign": None,

        "cooldown_counter": 0,

        "frame_count": 0,

        "detected_count": 0,

        "last_prediction": "Waiting...",

        "last_confidence": 0.0,
        "sentence_words": [],
    }


# ============================================================
# RESET SESSION
# ============================================================

def reset_session_state(session):

    session["sequence_buffer"].clear()
    session["detection_buffer"].clear()
    session["prediction_buffer"].clear()

    session["stable_prediction"] = None
    session["stable_count"] = 0
    session["accepted_sign"] = None
    session["cooldown_counter"] = 0

    session["frame_count"] = 0
    session["detected_count"] = 0

    session["last_prediction"] = "Waiting..."
    session["last_confidence"] = 0.0

    session["sentence_words"].clear()

# ============================================================
# PREDICT ONE FRAME
# ============================================================

async def process_frame(frame, session):

    # Dynamic word recognition only.
    session["frame_count"] += 1

    print("CURRENT AI MODE:", session["mode"])

    # --------------------------------------------------------
    # MediaPipe
    # --------------------------------------------------------

    features, detected, result = (
        extract_frame_landmarks(frame)
    )

    if detected:
        session["detected_count"] += 1

    # --------------------------------------------------------
    # Add frame to sequence
    # --------------------------------------------------------

    session["sequence_buffer"].append(
        features
    )

    session["detection_buffer"].append(
        detected
    )

    # --------------------------------------------------------
    # Cooldown
    # --------------------------------------------------------

    if session["cooldown_counter"] > 0:
        session["cooldown_counter"] -= 1

    # --------------------------------------------------------
    # Need 30 frames
    # --------------------------------------------------------

    if (
        len(session["sequence_buffer"])
        < SEQUENCE_LENGTH
    ):

        return {
            "prediction": "Collecting...",
            "confidence": 0.0,
            "frames": len(
                session["sequence_buffer"]
            ),
            "detected": detected,
            "accepted": False,
            "word": None,
        }

    # --------------------------------------------------------
    # Prepare sequence
    # --------------------------------------------------------

    sequence = np.asarray(
        session["sequence_buffer"],
        dtype=np.float32
    )

    detected_sequence = np.asarray(
        session["detection_buffer"],
        dtype=bool
    )
    detected_frames = int(np.sum(detected_sequence))

    if detected_frames < 8:
        session["prediction_buffer"].clear()
        session["stable_prediction"] = None
        session["stable_count"] = 0

        return {
            "prediction": "Hand not detected",
            "confidence": 0.0,
            "frames": len(session["sequence_buffer"]),
            "detected": detected,
            "accepted": False,
            "word": None,
        }
    sequence = fill_missing_frames(
        sequence,
        detected_sequence
    )

    flattened = sequence.reshape(
        1,
        -1
    )

    expected_features = (
        SEQUENCE_LENGTH *
        FEATURE_SIZE
    )

    if flattened.shape[1] != expected_features:

        print(
            "\nERROR: Feature size mismatch."
        )

        print(
            "Expected:",
            expected_features
        )

        print(
            "Received:",
            flattened.shape[1]
        )

        return {
            "prediction": "Feature error",
            "confidence": 0.0,
            "frames": len(
                session["sequence_buffer"]
            ),
            "detected": detected,
            "accepted": False,
            "word": None,
        }

    # --------------------------------------------------------
    # V4 MODEL
    # --------------------------------------------------------

    probabilities = model.predict_proba(
        flattened
    )[0]

    best_index = np.argmax(
        probabilities
    )

    confidence = float(
        probabilities[best_index]
    )

    predicted_class = (
        model.classes_[best_index]
    )

    prediction = (
        label_encoder
        .inverse_transform(
            [predicted_class]
        )[0]
    )

    session["last_confidence"] = confidence

    # --------------------------------------------------------
    # Confidence filter
    # --------------------------------------------------------

    if confidence < CONFIDENCE_THRESHOLD:

        session["stable_prediction"] = None
        session["stable_count"] = 0

        return {
            "prediction": prediction,
            "confidence": confidence,
            "frames": len(
                session["sequence_buffer"]
            ),
            "detected": detected,
            "accepted": False,
            "word": None,
        }

    # --------------------------------------------------------
    # Prediction buffer
    # --------------------------------------------------------

    session["prediction_buffer"].append(
        prediction
    )

    counts = Counter(
        session["prediction_buffer"]
    )

    current_prediction = (
        counts
        .most_common(1)[0][0]
    )

    # --------------------------------------------------------
    # Stability
    # --------------------------------------------------------

    if (
        current_prediction
        == session["stable_prediction"]
    ):

        session["stable_count"] += 1

    else:

        session["stable_prediction"] = (
            current_prediction
        )

        session["stable_count"] = 1

    # --------------------------------------------------------
    # ACCEPT SIGN
    # --------------------------------------------------------

    accepted = False
    accepted_word = None

    if (
        session["stable_count"]
        >= STABLE_COUNT_REQUIRED

        and session["cooldown_counter"] == 0

        and session["accepted_sign"]
        != current_prediction
    ):

        accepted = True
        accepted_word = current_prediction
        session["sentence_words"].append(
            current_prediction
        )

        sentence = " ".join(
            session["sentence_words"]
        )

        print(
            "Sentence:",
            sentence
        )

        session["accepted_sign"] = (
            current_prediction
        )
        session["prediction_buffer"].clear()

        session["stable_prediction"] = None

        session["stable_count"] = 0 

        session["last_prediction"] = (
            current_prediction
        )

        print("\n" + "-" * 60)
        print(
            "DYNAMIC SIGN DETECTED:",
            current_prediction
        )
        print(
            f"Confidence: "
            f"{confidence * 100:.1f}%"
        )
        print(
            "Meeting:",
            session["meeting_id"]
        )
        print(
            "Sending to backend..."
        )

        # Send prediction without blocking
        # the WebSocket event loop.

        success = await asyncio.to_thread(
            backend.send_word,
            word=current_prediction,
            language="en"
        )

        if success:

            print(
                "✓ Dynamic sign sent successfully."
            )

        else:

            print(
                "✗ Dynamic sign was NOT sent."
            )

        print("-" * 60)

        session["cooldown_counter"] = (
            COOLDOWN_FRAMES
        )

    return {
        "prediction": current_prediction,
        "confidence": confidence,
        "frames": len(
            session["sequence_buffer"]
        ),
        "detected": detected,
        "accepted": accepted,
        "word": accepted_word,
    }



# ============================================================
# SENTENCE FORMATTER
# ============================================================

def format_sentence(words):
    """
    Convert recognized ISL words into simple natural English
    sentences for the classroom/education demo.

    The formatter intentionally supports only the selected
    combinations that can be produced from the 27-word model.
    """

    words = [
        str(word).lower().strip()
        for word in words
        if word
    ]

    if not words:
        return ""

    pattern = tuple(words)

    sentence_patterns = {
        ("hello", "teacher"):
            "Hello, teacher.",

        ("please", "help"):
            "Please help.",

        ("please", "help", "student"):
            "Please help the student.",

        ("teacher", "help", "student"):
            "The teacher helps the student.",

        ("student", "go", "school"):
            "The student goes to school.",

        ("today", "school"):
            "Today, I am at school.",

        ("where", "teacher"):
            "Where is the teacher?",

        ("where", "school"):
            "Where is the school?",

        ("what", "teacher"):
            "What is the teacher doing?",

        ("yes", "teacher"):
            "Yes, teacher.",

        ("no", "teacher"):
            "No, teacher.",

        ("thank_you", "teacher"):
            "Thank you, teacher.",

        ("he", "student"):
            "He is a student.",

        ("she", "student"):
            "She is a student.",

        ("friend", "school"):
            "My friend is at school.",
    }

    if pattern in sentence_patterns:
        return sentence_patterns[pattern]

    # Fallback: show the recognized words as a readable sentence.
    return " ".join(words).capitalize() + "."


# ============================================================
# WEBSOCKET CLIENT
# ============================================================

async def handle_client(websocket):

    print("\n========================================")
    print("Frontend connected!")
    print("========================================")

    session = create_session()

    try:

        async for message in websocket:

            if not isinstance(message, str):

                print(
                    "Received non-text WebSocket message"
                )

                continue

            # ------------------------------------------------
            # JSON
            # ------------------------------------------------

            try:

                data = json.loads(message)

            except json.JSONDecodeError:

                print(
                    "Received invalid JSON"
                )

                continue

            message_type = data.get(
                "type"
            )

            # =================================================
            # INIT
            # =================================================

            if message_type == "init":

                meeting_id = data.get(
                    "meetingId"
                )

                if not meeting_id:

                    print(
                        "ERROR: No meeting ID received."
                    )

                    await websocket.send(
                        json.dumps({
                            "type": "error",
                            "message":
                                "Meeting ID missing"
                        })
                    )

                    continue

                session["meeting_id"] = (
                    meeting_id
                )

                # IMPORTANT:
                # Use the actual meeting from React.

                backend.meeting_id = (
                    meeting_id
                )

                reset_session_state(
                    session
                )

                print(
                    "\n--- AI SESSION INITIALIZED ---"
                )

                print(
                    "Meeting ID:",
                    meeting_id
                )

                print(
                    "--------------------------------"
                )

                await websocket.send(
                    json.dumps({
                        "type": "init_ack",
                        "status": "connected",
                        "meetingId":
                            meeting_id,
                        "model":
                            "dynamic_v4_word_only",
                        "classes":
                            len(CLASSES),
                    })
                )

            # =================================================
            # MODE
            # =================================================

            elif message_type == "mode":

                # Keep this message for frontend compatibility.
                # The AI now uses dynamic word recognition only.
                mode = data.get("mode", "word")

                if mode != "word":
                    print(
                        "Static/letter mode ignored; using dynamic word mode."
                    )

                session["mode"] = "word"
                reset_session_state(session)

                await websocket.send(
                    json.dumps({
                        "type": "mode_ack",
                        "mode": "word"
                    })
                )
            # =================================================
            # FRAME
            # =================================================

            elif message_type == "frame":

                frame_data = data.get(
                    "data"
                )

                if not frame_data:

                    print(
                        "Frame received without image data"
                    )

                    continue

                try:

                    # -----------------------------------------
                    # Decode Base64
                    # -----------------------------------------

                    image_bytes = (
                        base64.b64decode(
                            frame_data
                        )
                    )

                    # -----------------------------------------
                    # Convert JPEG → OpenCV
                    # -----------------------------------------

                    np_buffer = np.frombuffer(
                        image_bytes,
                        dtype=np.uint8
                    )

                    frame = cv2.imdecode(
                        np_buffer,
                        cv2.IMREAD_COLOR
                    )

                    if frame is None:

                        print(
                            "ERROR: Could not decode image."
                        )

                        continue

                    print(
                        f"[{datetime.now().strftime('%H:%M:%S')}] "
                        f"Frame received: "
                        f"{len(image_bytes)} bytes"
                    )

                    # -----------------------------------------
                    # AI PROCESSING
                    # -----------------------------------------

                    result = await process_frame(
                        frame,
                        session
                    )

                    # -----------------------------------------
                    # Send result to frontend
                    # -----------------------------------------

                    response = {
                        "type": "prediction",

                        "prediction":
                            result["prediction"],

                        "confidence":
                            result["confidence"],

                        "frames":
                            result["frames"],

                        "accepted":
                            result["accepted"],

                        "word":
                            result["word"],

                        "sentence":
                            format_sentence(
                                session["sentence_words"]
                            ),

                        "meetingId":
                            session["meeting_id"],
                    }
                    await websocket.send(
                        json.dumps(response)
                    )

                except Exception as error:

                    print(
                        "Error processing frame:"
                    )

                    print(error)

                    try:

                        await websocket.send(
                            json.dumps({
                                "type": "error",
                                "message":
                                    "AI frame processing failed"
                            })
                        )

                    except Exception:
                        pass

            # =================================================
            # RESET
            # =================================================

            elif message_type == "reset":

                reset_session_state(
                    session
                )

            # =================================================
            # UNKNOWN
            # =================================================

            else:

                print(
                    "Unknown message type:",
                    message_type
                )

    except Exception as error:

        print(
            "Client disconnected:"
        )

        print(error)

    finally:

        print(
            "Frontend connection closed."
        )


# ============================================================
# SERVER
# ============================================================

async def main():

    print("\n" + "=" * 60)

    print(
        "Starting ISL AI WebSocket server..."
    )

    print(
        f"WebSocket: ws://{HOST}:{PORT}"
    )

    print(
        "Waiting for frontend connection..."
    )

    print(
        "=" * 60
    )

    async with serve(
        handle_client,
        HOST,
        PORT
    ):

        await asyncio.Future()


# ============================================================
# START
# ============================================================

if __name__ == "__main__":

    try:

        asyncio.run(main())

    except KeyboardInterrupt:

        print(
            "\nAI WebSocket server stopped."
        )

    finally:

        try:
            hands.close()
        except Exception:
            pass