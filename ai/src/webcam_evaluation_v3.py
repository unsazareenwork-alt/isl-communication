import os
import cv2
import joblib
import numpy as np
import pandas as pd
import mediapipe as mp

from collections import Counter


# ==========================================
# PATHS
# ==========================================

PROJECT_PATH = os.path.abspath(
    os.path.join(os.path.dirname(__file__), "..", "..")
)

MODEL_PATH = os.path.join(
    PROJECT_PATH,
    "isl_model_v3.pkl"
)


# ==========================================
# SETTINGS
# ==========================================

CAMERA_INDEX = 0

CONFIDENCE_THRESHOLD = 0.50

FRAMES_PER_SIGN = 30

STARTUP_COUNTDOWN = 3

CLASSES = list("ABCDEFGHIJKLMNOPQRSTUVWXYZ")


# ==========================================
# HEADER
# ==========================================

print("==========================================")
print("ISL V3 WEBCAM EVALUATION")
print("==========================================")


# ==========================================
# LOAD MODEL
# ==========================================

print("\nLoading Model V3...")

if not os.path.exists(MODEL_PATH):

    print("\nERROR: Model not found!")
    print(MODEL_PATH)

    raise SystemExit


model = joblib.load(
    MODEL_PATH
)

print("Model loaded successfully.")

print(
    "Classes:",
    len(model.classes_)
)

print(
    "Features:",
    model.n_features_in_
)


if model.n_features_in_ != 126:

    print(
        "\nERROR: Model expects something other than 126 features."
    )

    raise SystemExit


# ==========================================
# MEDIAPIPE
# ==========================================

mp_hands = mp.solutions.hands
mp_draw = mp.solutions.drawing_utils


hands = mp_hands.Hands(

    static_image_mode=False,

    max_num_hands=2,

    min_detection_confidence=0.5,

    min_tracking_confidence=0.5

)


# ==========================================
# NORMALIZATION
# ==========================================

def normalize_landmarks(landmarks):

    wrist = landmarks[0]

    relative_landmarks = []


    for landmark in landmarks:

        x = landmark.x - wrist.x
        y = landmark.y - wrist.y
        z = landmark.z - wrist.z

        relative_landmarks.append(
            [x, y, z]
        )


    max_value = max(

        abs(value)

        for landmark in relative_landmarks

        for value in landmark

    )


    if max_value == 0:

        max_value = 1


    normalized = []


    for landmark in relative_landmarks:

        for value in landmark:

            normalized.append(
                value / max_value
            )


    return normalized


# ==========================================
# FEATURE EXTRACTION
# ==========================================

def extract_features(results):

    if not results.multi_hand_landmarks:

        return None, 0


    left_hand = None
    right_hand = None


    for hand_landmarks, handedness in zip(

        results.multi_hand_landmarks,

        results.multi_handedness

    ):

        label = (
            handedness
            .classification[0]
            .label
        )


        if label == "Left":

            left_hand = (
                hand_landmarks.landmark
            )


        elif label == "Right":

            right_hand = (
                hand_landmarks.landmark
            )


    left_features = [0.0] * 63
    right_features = [0.0] * 63


    if left_hand is not None:

        left_features = normalize_landmarks(
            left_hand
        )


    if right_hand is not None:

        right_features = normalize_landmarks(
            right_hand
        )


    features = (
        left_features +
        right_features
    )


    if len(features) != 126:

        return None, 0


    feature_array = np.array(
        features
    ).reshape(1, -1)


    # IMPORTANT:
    # Use the same feature names
    # used during model training.

    if hasattr(model, "feature_names_in_"):

        features_df = pd.DataFrame(

            feature_array,

            columns=model.feature_names_in_

        )

        return (
            features_df,
            len(results.multi_hand_landmarks)
        )


    return (

        feature_array,

        len(results.multi_hand_landmarks)

    )


# ==========================================
# OPEN CAMERA
# ==========================================

print("\nOpening webcam...")

cap = cv2.VideoCapture(
    CAMERA_INDEX
)


if not cap.isOpened():

    print("\nERROR: Could not open webcam.")

    hands.close()

    raise SystemExit


print("Webcam opened successfully.")


# ==========================================
# RESULTS STORAGE
# ==========================================

results_summary = {}

total_correct = 0
total_predictions = 0


# ==========================================
# TEST EACH LETTER
# ==========================================

try:

    for expected_sign in CLASSES:

        print("\n")
        print("==========================================")
        print(f"GET READY FOR SIGN: {expected_sign}")
        print("==========================================")

        print(
            f"Show the '{expected_sign}' sign "
            f"in front of the camera."
        )

        print(
            "Starting in 3 seconds..."
        )


        # --------------------------------------
        # COUNTDOWN
        # --------------------------------------

        countdown_start = cv2.getTickCount()


        while True:

            ret, frame = cap.read()


            if not ret:

                print(
                    "\nERROR: Could not read frame."
                )

                raise SystemExit


            frame = cv2.flip(
                frame,
                1
            )


            elapsed = (

                cv2.getTickCount()
                - countdown_start

            ) / cv2.getTickFrequency()


            remaining = (
                STARTUP_COUNTDOWN
                - int(elapsed)
            )


            cv2.putText(

                frame,

                f"EXPECTED: {expected_sign}",

                (30, 50),

                cv2.FONT_HERSHEY_SIMPLEX,

                1.2,

                (0, 255, 0),

                3

            )


            if remaining > 0:

                cv2.putText(

                    frame,

                    f"Starting in {remaining}",

                    (30, 100),

                    cv2.FONT_HERSHEY_SIMPLEX,

                    1,

                    (255, 255, 255),

                    2

                )

            else:

                break


            cv2.imshow(
                "ISL V3 Webcam Evaluation",
                frame
            )


            key = cv2.waitKey(1) & 0xFF


            if key == ord("q"):

                raise SystemExit


        # --------------------------------------
        # COLLECT PREDICTIONS
        # --------------------------------------

        predictions = []

        confidences = []

        valid_frames = 0


        for frame_index in range(
            FRAMES_PER_SIGN
        ):

            ret, frame = cap.read()


            if not ret:

                print(
                    "\nERROR: Could not read frame."
                )

                break


            frame = cv2.flip(
                frame,
                1
            )


            rgb = cv2.cvtColor(

                frame,

                cv2.COLOR_BGR2RGB

            )


            mp_results = hands.process(
                rgb
            )


            # ----------------------------------
            # DRAW LANDMARKS
            # ----------------------------------

            if mp_results.multi_hand_landmarks:

                for hand_landmarks in (
                    mp_results.multi_hand_landmarks
                ):

                    mp_draw.draw_landmarks(

                        frame,

                        hand_landmarks,

                        mp_hands.HAND_CONNECTIONS

                    )


            # ----------------------------------
            # FEATURES
            # ----------------------------------

            features, hand_count = (
                extract_features(
                    mp_results
                )
            )


            prediction_text = "No hand"

            confidence_text = ""


            if features is not None:

                prediction = model.predict(
                    features
                )[0]


                probabilities = (
                    model.predict_proba(
                        features
                    )[0]
                )


                confidence = float(
                    np.max(probabilities)
                )


                prediction_text = (
                    f"Prediction: {prediction}"
                )


                confidence_text = (

                    f"Confidence: "
                    f"{confidence * 100:.1f}%"

                )


                if confidence >= (
                    CONFIDENCE_THRESHOLD
                ):

                    predictions.append(
                        prediction
                    )

                    confidences.append(
                        confidence
                    )

                    valid_frames += 1


            # ----------------------------------
            # DISPLAY
            # ----------------------------------

            cv2.putText(

                frame,

                f"Expected: {expected_sign}",

                (20, 40),

                cv2.FONT_HERSHEY_SIMPLEX,

                1,

                (0, 255, 0),

                2

            )


            cv2.putText(

                frame,

                prediction_text,

                (20, 80),

                cv2.FONT_HERSHEY_SIMPLEX,

                0.8,

                (255, 255, 255),

                2

            )


            cv2.putText(

                frame,

                confidence_text,

                (20, 115),

                cv2.FONT_HERSHEY_SIMPLEX,

                0.7,

                (255, 255, 255),

                2

            )


            cv2.putText(

                frame,

                f"Frame: "
                f"{frame_index + 1}/"
                f"{FRAMES_PER_SIGN}",

                (20, 150),

                cv2.FONT_HERSHEY_SIMPLEX,

                0.7,

                (255, 255, 255),

                2

            )


            cv2.putText(

                frame,

                f"Valid frames: {valid_frames}",

                (20, 185),

                cv2.FONT_HERSHEY_SIMPLEX,

                0.7,

                (255, 255, 255),

                2

            )


            cv2.putText(

                frame,

                "Q = Quit",

                (20, 220),

                cv2.FONT_HERSHEY_SIMPLEX,

                0.6,

                (255, 255, 255),

                2

            )


            cv2.imshow(

                "ISL V3 Webcam Evaluation",

                frame

            )


            key = cv2.waitKey(1) & 0xFF


            if key == ord("q"):

                raise SystemExit


        # --------------------------------------
        # CALCULATE RESULT
        # --------------------------------------

        if len(predictions) == 0:

            results_summary[expected_sign] = {

                "accuracy": 0.0,

                "correct": 0,

                "total": 0,

                "average_confidence": 0.0,

                "top_prediction": "NONE"

            }

            print(
                f"\n{expected_sign}: "
                "No valid predictions"
            )

            continue


        prediction_counts = Counter(
            predictions
        )


        top_prediction, top_count = (
            prediction_counts.most_common(1)[0]
        )


        correct = prediction_counts.get(
            expected_sign,
            0
        )


        accuracy = (
            correct /
            len(predictions)
        )


        average_confidence = (
            np.mean(confidences)
        )


        results_summary[expected_sign] = {

            "accuracy": accuracy,

            "correct": correct,

            "total": len(predictions),

            "average_confidence":
                average_confidence,

            "top_prediction":
                top_prediction

        }


        total_correct += correct

        total_predictions += len(
            predictions
        )


        print("\n------------------------------------------")

        print(
            f"RESULT: {expected_sign}"
        )

        print(
            f"Correct: "
            f"{correct}/{len(predictions)}"
        )

        print(
            f"Accuracy: "
            f"{accuracy * 100:.2f}%"
        )

        print(
            f"Average confidence: "
            f"{average_confidence * 100:.2f}%"
        )

        print(
            f"Most common prediction: "
            f"{top_prediction}"
        )

        print(
            "Prediction distribution:"
        )

        print(
            dict(prediction_counts)
        )


# ==========================================
# CLEANUP
# ==========================================

except KeyboardInterrupt:

    print(
        "\nEvaluation interrupted."
    )


finally:

    cap.release()

    cv2.destroyAllWindows()

    hands.close()


# ==========================================
# FINAL REPORT
# ==========================================

print("\n\n")
print("==========================================")
print("FINAL V3 WEBCAM EVALUATION")
print("==========================================")


print("\nSign-by-sign results:\n")


for sign in CLASSES:

    if sign not in results_summary:

        print(
            f"{sign}: NOT TESTED"
        )

        continue


    result = results_summary[sign]


    print(

        f"{sign}: "

        f"{result['accuracy'] * 100:6.2f}% "

        f"| "

        f"{result['correct']}/"
        f"{result['total']} "

        f"| Avg confidence: "

        f"{result['average_confidence'] * 100:5.1f}% "

        f"| Top: "

        f"{result['top_prediction']}"

    )


print("\n==========================================")


if total_predictions > 0:

    overall_accuracy = (
        total_correct /
        total_predictions
    )


    print(
        f"Overall accuracy: "
        f"{overall_accuracy * 100:.2f}%"
    )

    print(
        f"Total correct: "
        f"{total_correct}"
    )

    print(
        f"Total predictions: "
        f"{total_predictions}"
    )

else:

    print(
        "No predictions collected."
    )


print("==========================================")
print("V3 WEBCAM EVALUATION COMPLETED")
print("==========================================")