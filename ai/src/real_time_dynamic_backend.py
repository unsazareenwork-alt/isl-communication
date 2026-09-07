import os
import cv2
import numpy as np
import joblib
import mediapipe as mp

from collections import deque, Counter

from backend_client import BackendClient


# ============================================================
# CONFIGURATION
# ============================================================

MODEL_PATH = os.path.abspath(
    os.path.join(
        os.path.dirname(__file__),
        "..",
        "dynamic_model_v4.pkl"
    )
)

CONFIDENCE_THRESHOLD = 0.20

PREDICTION_WINDOW = 5

STABLE_COUNT_REQUIRED = 3

COOLDOWN_FRAMES = 30


# ============================================================
# START
# ============================================================

print("=" * 60)
print("ISL DYNAMIC AI → BACKEND")
print("WEBCAM → AI → WORD → BACKEND")
print("=" * 60)


# ============================================================
# LOAD MODEL
# ============================================================

print("\nLoading dynamic V4 model...")

if not os.path.exists(MODEL_PATH):

    print("\nERROR: Model file not found!")

    print(
        "Expected:",
        MODEL_PATH
    )

    raise SystemExit


model_data = joblib.load(
    MODEL_PATH
)


# V4 model package

model = model_data["model"]

label_encoder = model_data["label_encoder"]

SEQUENCE_LENGTH = model_data["sequence_length"]

FEATURE_SIZE = model_data["feature_size"]

CLASSES = model_data["classes"]


print("Model loaded successfully.")

print("Model:", MODEL_PATH)

print("Sequence length:", SEQUENCE_LENGTH)

print("Feature size:", FEATURE_SIZE)

print("Number of classes:", len(CLASSES))

print("Classes:", CLASSES)


# ============================================================
# MEDIAPIPE
# ============================================================

mp_hands = mp.solutions.hands

mp_draw = mp.solutions.drawing_utils


hands = mp_hands.Hands(

    static_image_mode=False,

    max_num_hands=2,

    min_detection_confidence=0.5,

    min_tracking_confidence=0.5
)


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

    raise SystemExit


# ============================================================
# USE REAL DEPLOYED FRONTEND MEETING
# ============================================================

backend.meeting_id = "f1704e58-3409-4b32-9f15-0b33ab618d9a"

print("\nAI → BACKEND READY")

print("Using REAL deployed frontend meeting:")
print("Meeting ID:", backend.meeting_id)

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


    # ========================================================
    # LEFT HAND = FIRST 63
    # RIGHT HAND = NEXT 63
    # ========================================================

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
# CAMERA
# ============================================================

print("\nOpening camera...")


cap = cv2.VideoCapture(0)


if not cap.isOpened():

    print(
        "ERROR: Could not open camera."
    )

    hands.close()

    raise SystemExit


print(
    "Camera opened successfully."
)


print("\nControls:")

print("Q = Quit")

print("R = Reset")

print("\nPerform one dynamic sign at a time.")


# ============================================================
# BUFFERS
# ============================================================

sequence_buffer = deque(

    maxlen=SEQUENCE_LENGTH

)


detection_buffer = deque(

    maxlen=SEQUENCE_LENGTH

)


prediction_buffer = deque(

    maxlen=PREDICTION_WINDOW

)


# ============================================================
# STATE
# ============================================================

last_prediction = "Waiting..."

stable_prediction = None

stable_count = 0

accepted_sign = None

cooldown_counter = 0

frame_count = 0

detected_count = 0

last_confidence = 0.0


# ============================================================
# MAIN LOOP
# ============================================================

while True:

    ret, frame = cap.read()


    if not ret:

        print(
            "ERROR: Could not read frame."
        )

        break


    frame_count += 1


    # ========================================================
    # EXTRACT FEATURES
    # ========================================================

    features, detected, result = (

        extract_frame_landmarks(frame)

    )


    if detected:

        detected_count += 1


    # ========================================================
    # DRAW LANDMARKS
    # ========================================================

    if result.multi_hand_landmarks:

        for hand_landmarks in (

            result.multi_hand_landmarks

        ):

            mp_draw.draw_landmarks(

                frame,

                hand_landmarks,

                mp_hands.HAND_CONNECTIONS

            )


    # ========================================================
    # BUFFER
    # ========================================================

    sequence_buffer.append(

        features

    )


    detection_buffer.append(

        detected

    )


    # ========================================================
    # COOLDOWN
    # ========================================================

    if cooldown_counter > 0:

        cooldown_counter -= 1


    # ========================================================
    # PREDICT AFTER 30 FRAMES
    # ========================================================

    confidence_text = "--"


    if len(sequence_buffer) == SEQUENCE_LENGTH:

        sequence = np.asarray(

            sequence_buffer,

            dtype=np.float32

        )


        detected_sequence = np.asarray(

            detection_buffer,

            dtype=bool

        )


        # Match training preprocessing

        sequence = fill_missing_frames(

            sequence,

            detected_sequence

        )


        flattened = sequence.reshape(

            1,
            -1

        )


        # ====================================================
        # SAFETY CHECK
        # ====================================================

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

            break


        # ====================================================
        # MODEL
        # ====================================================

        probabilities = (

            model.predict_proba(

                flattened

            )[0]

        )


        best_index = np.argmax(

            probabilities

        )


        confidence = float(

            probabilities[best_index]

        )


        last_confidence = confidence


        # ====================================================
        # DECODE
        # ====================================================

        predicted_class = (

            model.classes_[best_index]

        )


        prediction = (

            label_encoder
            .inverse_transform(
                [predicted_class]
            )[0]

        )


        confidence_text = (

            f"{confidence * 100:.1f}%"

        )


        # ====================================================
        # CONFIDENCE FILTER
        # ====================================================

        if confidence >= CONFIDENCE_THRESHOLD:

            prediction_buffer.append(

                prediction

            )


            # =================================================
            # MAJORITY VOTE
            # =================================================

            counts = Counter(

                prediction_buffer

            )


            current_prediction = (

                counts
                .most_common(1)[0][0]

            )


            # =================================================
            # STABILITY
            # =================================================

            if (

                current_prediction
                == stable_prediction

            ):

                stable_count += 1


            else:

                stable_prediction = (

                    current_prediction

                )

                stable_count = 1


            # =================================================
            # ACCEPT SIGN
            # =================================================

            if (

                stable_count
                >= STABLE_COUNT_REQUIRED

                and cooldown_counter == 0

            ):

                if (

                    accepted_sign
                    != current_prediction

                ):

                    accepted_sign = (

                        current_prediction

                    )


                    last_prediction = (

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


                    # =================================================
                    # SEND TO BACKEND
                    # =================================================

                    print(
                        "Sending to backend..."
                    )


                    success = backend.send_word(

                        word=current_prediction,

                        language="en"

                    )


                    if success:

                        print(
                            "✓ Dynamic sign sent "
                            "successfully."
                        )

                    else:

                        print(
                            "✗ Dynamic sign "
                            "was NOT sent."
                        )


                    print("-" * 60)


                    cooldown_counter = (

                        COOLDOWN_FRAMES

                    )


        else:

            stable_prediction = None

            stable_count = 0


    # ========================================================
    # DISPLAY
    # ========================================================

    buffer_text = (

        f"Frames: "
        f"{len(sequence_buffer)}/"
        f"{SEQUENCE_LENGTH}"

    )


    detection_ratio = (

        detected_count /
        frame_count

    )


    detection_text = (

        f"Detection: "
        f"{detection_ratio * 100:.1f}%"

    )


    stability_text = (

        f"Stable: "
        f"{stable_count}/"
        f"{STABLE_COUNT_REQUIRED}"

    )


    cooldown_text = (

        f"Cooldown: "
        f"{cooldown_counter}"

    )


    cv2.putText(

        frame,

        f"Prediction: {last_prediction}",

        (20, 40),

        cv2.FONT_HERSHEY_SIMPLEX,

        1,

        (0, 255, 0),

        2

    )


    cv2.putText(

        frame,

        f"Confidence: {confidence_text}",

        (20, 80),

        cv2.FONT_HERSHEY_SIMPLEX,

        0.7,

        (255, 255, 255),

        2

    )


    cv2.putText(

        frame,

        buffer_text,

        (20, 115),

        cv2.FONT_HERSHEY_SIMPLEX,

        0.7,

        (255, 255, 255),

        2

    )


    cv2.putText(

        frame,

        detection_text,

        (20, 150),

        cv2.FONT_HERSHEY_SIMPLEX,

        0.7,

        (255, 255, 255),

        2

    )


    cv2.putText(

        frame,

        stability_text,

        (20, 185),

        cv2.FONT_HERSHEY_SIMPLEX,

        0.7,

        (255, 255, 255),

        2

    )


    cv2.putText(

        frame,

        cooldown_text,

        (20, 220),

        cv2.FONT_HERSHEY_SIMPLEX,

        0.7,

        (255, 255, 255),

        2

    )


    cv2.putText(

        frame,

        "AI -> BACKEND | Q=quit R=reset",

        (20, 255),

        cv2.FONT_HERSHEY_SIMPLEX,

        0.6,

        (255, 255, 255),

        2

    )


    # ========================================================
    # SHOW
    # ========================================================

    cv2.imshow(

        "ISL Dynamic AI -> Backend",

        frame

    )


    # ========================================================
    # KEYBOARD
    # ========================================================

    key = cv2.waitKey(1) & 0xFF


    if key == ord("q"):

        break


    elif key == ord("r"):

        sequence_buffer.clear()

        detection_buffer.clear()

        prediction_buffer.clear()

        last_prediction = "Waiting..."

        stable_prediction = None

        stable_count = 0

        accepted_sign = None

        cooldown_counter = 0

        last_confidence = 0.0

        print("\nBuffers reset.")


# ============================================================
# CLEANUP
# ============================================================

cap.release()

cv2.destroyAllWindows()

hands.close()


print("\n" + "=" * 60)

print("DYNAMIC AI → BACKEND STOPPED")

print("=" * 60)

print(
    f"Total frames: {frame_count}"
)

if frame_count > 0:

    print(

        f"Overall detection ratio: "
        f"{detected_count / frame_count * 100:.2f}%"

    )

print(
    "Meeting:",
    backend.meeting_id
)