import os
import cv2
import csv
import mediapipe as mp

# ==========================================
# DATASET PATHS
# ==========================================

BASE_PATH = r"C:\Users\goyal\Documents\isl-datasets\Static gestures of Indian Sign Language (ISL) for English Alphabet, Hindi Vowels and Numerals\ISL Images"

TRAINING_PATHS = [
    # Adults - Full Sleeves
    os.path.join(
        BASE_PATH,
        "3. Adults ISL Images",
        "Adults ISL images in Full Sleeves",
        "English Alphabet"
    ),

    # Adults - Half Sleeves
    os.path.join(
        BASE_PATH,
        "3. Adults ISL Images",
        "Adults ISL images in Half Sleeves",
        "English Alphabet"
    ),

    # Teenagers - Full Sleeves
    os.path.join(
        BASE_PATH,
        "2. Teenagers ISL Images",
        "Teenagers ISL images in Full Sleeves",
        "English Alphabet"
    ),

    # Teenagers - Half Sleeves
    os.path.join(
        BASE_PATH,
        "2. Teenagers ISL Images",
        "Teenagers ISL images in Half Sleeves",
        "English Alphabet"
    )
]

OUTPUT_FILE = "training_v2.csv"

# Only A, B, C for now
CLASSES = ["A", "B", "C"]


# ==========================================
# MEDIAPIPE SETUP
# ==========================================

mp_hands = mp.solutions.hands

hands = mp_hands.Hands(
    static_image_mode=True,
    max_num_hands=2,
    min_detection_confidence=0.5
)


# ==========================================
# NORMALIZE LANDMARKS
# ==========================================

def normalize_landmarks(landmarks):

    wrist = landmarks[0]

    relative_landmarks = []

    for landmark in landmarks:

        x = landmark.x - wrist.x
        y = landmark.y - wrist.y
        z = landmark.z - wrist.z

        relative_landmarks.append([x, y, z])

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
            normalized.append(value / max_value)

    return normalized


# ==========================================
# PROCESS ONE IMAGE
# ==========================================

def process_image(image_path):

    image = cv2.imread(image_path)

    if image is None:
        return None

    image_rgb = cv2.cvtColor(
        image,
        cv2.COLOR_BGR2RGB
    )

    results = hands.process(image_rgb)

    if not results.multi_hand_landmarks:
        return None

    left_hand = None
    right_hand = None

    for hand_landmarks, handedness in zip(
        results.multi_hand_landmarks,
        results.multi_handedness
    ):

        label = handedness.classification[0].label

        if label == "Left":
            left_hand = hand_landmarks.landmark

        elif label == "Right":
            right_hand = hand_landmarks.landmark

    # 63 features per hand
    left_features = [0.0] * 63
    right_features = [0.0] * 63

    if left_hand is not None:
        left_features = normalize_landmarks(left_hand)

    if right_hand is not None:
        right_features = normalize_landmarks(right_hand)

    # 63 + 63 = 126
    return left_features + right_features


# ==========================================
# CREATE DATASET
# ==========================================

print("==========================================")
print("STARTING TRAINING DATASET V2 EXTRACTION")
print("==========================================")


header = [f"feature_{i}" for i in range(126)]
header.append("label")

processed = 0
failed = 0

with open(
    OUTPUT_FILE,
    "w",
    newline=""
) as csv_file:

    writer = csv.writer(csv_file)

    writer.writerow(header)

    # Go through all four training folders
    for dataset_path in TRAINING_PATHS:

        print("\n------------------------------------------")
        print("Dataset:")
        print(dataset_path)
        print("------------------------------------------")

        for label in CLASSES:

            class_path = os.path.join(
                dataset_path,
                label
            )

            print(f"\nProcessing class: {label}")

            if not os.path.exists(class_path):

                print("WARNING: Folder not found!")
                continue

            for filename in os.listdir(class_path):

                image_path = os.path.join(
                    class_path,
                    filename
                )

                features = process_image(image_path)

                if features is None:

                    failed += 1
                    continue

                writer.writerow(
                    features + [label]
                )

                processed += 1

            print(f"Finished class: {label}")


hands.close()


# ==========================================
# FINAL RESULTS
# ==========================================

print("\n==========================================")
print("EXTRACTION COMPLETED")
print("==========================================")

print("Images processed:", processed)
print("Images failed:", failed)
print("Features per image: 126")
print("Output file:", OUTPUT_FILE)