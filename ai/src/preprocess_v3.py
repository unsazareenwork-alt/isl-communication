import os
import cv2
import csv
import mediapipe as mp


# ==========================================
# DATASET PATH
# ==========================================

BASE_PATH = r"C:\Users\kkari\Documents\isl-datasets\Static gestures of Indian Sign Language (ISL) for English Alphabet, Hindi Vowels and Numerals\ISL Images"


# ==========================================
# DATASET SOURCES
# ==========================================

TRAINING_PATHS = [
    os.path.join(
        BASE_PATH,
        "3. Adults ISL Images",
        "Adults ISL images in Full Sleeves",
        "English Alphabet"
    ),

    os.path.join(
        BASE_PATH,
        "3. Adults ISL Images",
        "Adults ISL images in Half Sleeves",
        "English Alphabet"
    ),

    os.path.join(
        BASE_PATH,
        "2. Teenagers ISL Images",
        "Teenagers ISL images in Full Sleeves",
        "English Alphabet"
    ),

    os.path.join(
        BASE_PATH,
        "2. Teenagers ISL Images",
        "Teenagers ISL images in Half Sleeves",
        "English Alphabet"
    )
]


# ==========================================
# OUTPUT
# ==========================================

OUTPUT_FILE = "preprocessed_v3.csv"


# ==========================================
# FINAL 26 CLASSES
# ==========================================

CLASSES = [
    "A", "B", "C", "D", "E",
    "F", "G", "H", "I", "J",
    "K", "L", "M", "N", "O",
    "P", "Q", "R", "S", "T",
    "U", "V", "W", "X", "Y", "Z"
]


# ==========================================
# DATASET FOLDER MAPPING
# ==========================================

DATASET_FOLDER_MAPPING = {
    "A": ["A"],
    "B": ["B"],
    "C": ["C"],
    "D": ["D"],
    "E": ["E1", "E2"],
    "F": ["F"],
    "G": ["G"],
    "H": ["H"],
    "I": ["I"],
    "J": ["J"],
    "K": ["K"],
    "L": ["L"],
    "M": ["M"],
    "N": ["N"],
    "O": ["O"],
    "P": ["P"],
    "Q": ["Q"],
    "R": ["R"],
    "S": ["S"],
    "T": ["T"],
    "U": ["U"],
    "V": ["V"],
    "W": ["W"],
    "X": ["X"],
    "Y": ["Y"],
    "Z": ["Z"]
}


# ==========================================
# MEDIAPIPE
# ==========================================

mp_hands = mp.solutions.hands

hands = mp_hands.Hands(
    static_image_mode=True,
    max_num_hands=2,
    min_detection_confidence=0.5
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

            normalized.append(
                value / max_value
            )

    return normalized


# ==========================================
# PROCESS IMAGE
# ==========================================

def process_image(image_path):

    image = cv2.imread(image_path)

    if image is None:
        return None, "unreadable"

    image_rgb = cv2.cvtColor(
        image,
        cv2.COLOR_BGR2RGB
    )

    results = hands.process(image_rgb)

    if not results.multi_hand_landmarks:
        return None, "no_hand"

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

        left_features = normalize_landmarks(
            left_hand
        )

    if right_hand is not None:

        right_features = normalize_landmarks(
            right_hand
        )

    # 63 + 63 = 126
    features = left_features + right_features

    if len(features) != 126:
        return None, "invalid_features"

    return features, "success"


# ==========================================
# START
# ==========================================

print("=" * 60)
print("ISL V3 DATASET PREPROCESSING")
print("=" * 60)

print("\nDataset base path:")
print(BASE_PATH)


# ==========================================
# CHECK DATASET
# ==========================================

if not os.path.exists(BASE_PATH):

    print("\nERROR: Dataset path does not exist.")

    hands.close()

    raise SystemExit


# ==========================================
# STATISTICS
# ==========================================

stats = {}

for label in CLASSES:

    stats[label] = {
        "total": 0,
        "detected": 0,
        "no_hand": 0,
        "unreadable": 0,
        "invalid_features": 0
    }


total_processed = 0


# ==========================================
# CSV HEADER
# ==========================================

header = [
    f"feature_{i}"
    for i in range(126)
]

header.append("label")


# ==========================================
# CREATE CSV
# ==========================================

with open(
    OUTPUT_FILE,
    "w",
    newline=""
) as csv_file:

    writer = csv.writer(csv_file)

    writer.writerow(header)

    # ======================================
    # DATASET SOURCES
    # ======================================

    for dataset_path in TRAINING_PATHS:

        print("\n" + "-" * 60)
        print("SOURCE:")
        print(dataset_path)
        print("-" * 60)

        if not os.path.exists(dataset_path):

            print("WARNING: Source folder missing.")
            continue


        # ==================================
        # CLASSES
        # ==================================

        for label in CLASSES:

            folder_names = DATASET_FOLDER_MAPPING[label]

            source_total = 0
            source_detected = 0

            for folder_name in folder_names:

                class_path = os.path.join(
                    dataset_path,
                    folder_name
                )

                if not os.path.exists(class_path):

                    print(
                        f"WARNING: {folder_name} not found."
                    )

                    continue

                for filename in os.listdir(class_path):

                    image_path = os.path.join(
                        class_path,
                        filename
                    )

                    if not os.path.isfile(image_path):
                        continue

                    stats[label]["total"] += 1
                    source_total += 1

                    features, status = process_image(
                        image_path
                    )

                    if status == "success":

                        writer.writerow(
                            features + [label]
                        )

                        stats[label]["detected"] += 1
                        source_detected += 1
                        total_processed += 1

                    elif status == "no_hand":

                        stats[label]["no_hand"] += 1

                    elif status == "unreadable":

                        stats[label]["unreadable"] += 1

                    elif status == "invalid_features":

                        stats[label]["invalid_features"] += 1

            print(
                f"{label}: "
                f"total={source_total}, "
                f"detected={source_detected}"
            )


# ==========================================
# CLEANUP
# ==========================================

hands.close()


# ==========================================
# FINAL REPORT
# ==========================================

print("\n")
print("=" * 80)
print("V3 DATASET PREPROCESSING COMPLETED")
print("=" * 80)

print(
    f"{'CLASS':<8}"
    f"{'TOTAL':<10}"
    f"{'DETECTED':<12}"
    f"{'NO HAND':<12}"
    f"{'UNREADABLE':<14}"
    f"{'INVALID':<10}"
)

print("-" * 80)

grand_total = 0
grand_detected = 0
grand_no_hand = 0
grand_unreadable = 0
grand_invalid = 0

for label in CLASSES:

    s = stats[label]

    print(
        f"{label:<8}"
        f"{s['total']:<10}"
        f"{s['detected']:<12}"
        f"{s['no_hand']:<12}"
        f"{s['unreadable']:<14}"
        f"{s['invalid_features']:<10}"
    )

    grand_total += s["total"]
    grand_detected += s["detected"]
    grand_no_hand += s["no_hand"]
    grand_unreadable += s["unreadable"]
    grand_invalid += s["invalid_features"]


print("-" * 80)

print(
    f"{'TOTAL':<8}"
    f"{grand_total:<10}"
    f"{grand_detected:<12}"
    f"{grand_no_hand:<12}"
    f"{grand_unreadable:<14}"
    f"{grand_invalid:<10}"
)

print("=" * 80)

print("\nFeatures per image:", 126)
print("Final classes:", len(CLASSES))
print("Output file:", OUTPUT_FILE)

print("\nClass mapping:")
print("E1 + E2 -> E")

print("\nV3 preprocessing finished.")