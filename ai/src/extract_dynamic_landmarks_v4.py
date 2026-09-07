import os
import json
import cv2
import numpy as np
import mediapipe as mp


# ============================================================
# CONFIGURATION
# ============================================================

DATASET_PATH = os.path.abspath(
    os.path.join(
        os.path.dirname(__file__),
        "..",
        "dynamic_dataset"
    )
)

OUTPUT_PATH = os.path.abspath(
    os.path.join(
        os.path.dirname(__file__),
        "..",
        "dynamic_landmarks_v4.npz"
    )
)

SEQUENCE_LENGTH = 30

# We sample more frames first, then select the best 30.
INITIAL_SAMPLE_COUNT = 60

# Minimum percentage of sampled frames where a hand
# must be detected for the video to be considered usable.
MIN_DETECTION_RATIO = 0.30

# Only use these signers.
SIGNERS_TO_TEST = [
    f"User{i:03d}"
    for i in range(1, 16)
]


# ============================================================
# MEDIAPIPE
# ============================================================

mp_hands = mp.solutions.hands

hands = mp_hands.Hands(
    static_image_mode=False,
    max_num_hands=2,
    min_detection_confidence=0.5,
    min_tracking_confidence=0.5
)


# ============================================================
# NORMALIZE HAND
# ============================================================

def normalize_hand(landmarks):

    points = np.array(
        [[lm.x, lm.y, lm.z] for lm in landmarks],
        dtype=np.float32
    )

    # Wrist as origin
    wrist = points[0].copy()

    points = points - wrist

    # Scale normalization
    scale = np.max(
        np.linalg.norm(points, axis=1)
    )

    if scale > 0:
        points = points / scale

    return points.flatten()


# ============================================================
# EXTRACT FRAME LANDMARKS
# ============================================================

def extract_frame_landmarks(frame):

    rgb = cv2.cvtColor(
        frame,
        cv2.COLOR_BGR2RGB
    )

    result = hands.process(rgb)

    features = np.zeros(
        126,
        dtype=np.float32
    )

    if not result.multi_hand_landmarks:
        return features, False

    detected = {}

    if result.multi_handedness:

        for i, handedness in enumerate(
            result.multi_handedness
        ):

            label = (
                handedness.classification[0].label
            )

            if label in ["Left", "Right"]:
                detected[label] = i

    # --------------------------------------------------------
    # 126 FEATURES
    #
    # Left hand  = 63
    # Right hand = 63
    # --------------------------------------------------------

    for side, start in [
        ("Left", 0),
        ("Right", 63)
    ]:

        if side in detected:

            index = detected[side]

            hand_landmarks = (
                result.multi_hand_landmarks[index]
            )

            hand_features = normalize_hand(
                hand_landmarks.landmark
            )

            features[
                start:start + 63
            ] = hand_features

    return features, True


# ============================================================
# READ VIDEO
# ============================================================

def read_video_frames(video_path):

    cap = cv2.VideoCapture(video_path)

    if not cap.isOpened():
        return []

    total_frames = int(
        cap.get(cv2.CAP_PROP_FRAME_COUNT)
    )

    if total_frames <= 0:
        cap.release()
        return []

    # --------------------------------------------------------
    # Sample more frames than we ultimately need.
    #
    # Example:
    # 30-frame sequence
    # → initially inspect 60 frames
    # --------------------------------------------------------

    sample_count = min(
        INITIAL_SAMPLE_COUNT,
        total_frames
    )

    indices = np.linspace(
        0,
        total_frames - 1,
        sample_count,
        dtype=int
    )

    frames = []

    for index in indices:

        cap.set(
            cv2.CAP_PROP_POS_FRAMES,
            int(index)
        )

        ret, frame = cap.read()

        if ret:
            frames.append(frame)

    cap.release()

    return frames


# ============================================================
# FILL MISSING FRAMES
# ============================================================

def fill_missing_frames(sequence, detected):

    sequence = np.asarray(
        sequence,
        dtype=np.float32
    )

    detected = np.asarray(
        detected,
        dtype=bool
    )

    # Nothing missing
    if detected.all():
        return sequence

    detected_indices = np.where(
        detected
    )[0]

    # No hand detected anywhere
    if len(detected_indices) == 0:
        return sequence

    # Replace missing frames with nearest
    # detected frame.
    for i in range(len(sequence)):

        if detected[i]:
            continue

        distances = np.abs(
            detected_indices - i
        )

        nearest = detected_indices[
            np.argmin(distances)
        ]

        sequence[i] = sequence[nearest]

    return sequence


# ============================================================
# SELECT BEST 30 FRAMES
# ============================================================

def select_best_sequence(features, detected):

    features = np.asarray(
        features,
        dtype=np.float32
    )

    detected = np.asarray(
        detected,
        dtype=bool
    )

    detected_indices = np.where(
        detected
    )[0]

    # --------------------------------------------------------
    # If enough detected frames exist,
    # select 30 detected frames spread across
    # the whole movement.
    # --------------------------------------------------------

    if len(detected_indices) >= SEQUENCE_LENGTH:

        selected_indices = np.linspace(
            0,
            len(detected_indices) - 1,
            SEQUENCE_LENGTH,
            dtype=int
        )

        selected_indices = (
            detected_indices[selected_indices]
        )

        return (
            features[selected_indices],
            np.ones(
                SEQUENCE_LENGTH,
                dtype=bool
            )
        )

    # --------------------------------------------------------
    # If fewer than 30 detected frames exist,
    # preserve the temporal structure and fill
    # missing frames.
    # --------------------------------------------------------

    if len(features) >= SEQUENCE_LENGTH:

        selected_indices = np.linspace(
            0,
            len(features) - 1,
            SEQUENCE_LENGTH,
            dtype=int
        )

        selected_features = (
            features[selected_indices]
        )

        selected_detected = (
            detected[selected_indices]
        )

        selected_features = fill_missing_frames(
            selected_features,
            selected_detected
        )

        return (
            selected_features,
            selected_detected
        )

    return None, None


# ============================================================
# FIND MATCHING VIDEO
# ============================================================

def find_video_for_json(word_dir, json_name):

    base_name = os.path.splitext(
        json_name
    )[0]

    video_name = (
        base_name + ".mp4"
    )

    video_path = os.path.join(
        word_dir,
        video_name
    )

    if os.path.isfile(video_path):

        return (
            video_path,
            video_name
        )

    return None, None


# ============================================================
# DISCOVER WORD FOLDERS
# ============================================================

def discover_words():

    if not os.path.isdir(DATASET_PATH):

        print(
            "ERROR: Dataset folder does not exist:"
        )

        print(DATASET_PATH)

        return []

    words = []

    for item in os.listdir(DATASET_PATH):

        path = os.path.join(
            DATASET_PATH,
            item
        )

        if os.path.isdir(path):

            words.append(item)

    words.sort()

    return words


# ============================================================
# MAIN
# ============================================================

print("=" * 60)
print("ISL DYNAMIC LANDMARK EXTRACTION V4")
print("IMPROVED MULTI-WORD DATASET")
print("=" * 60)

print("\nDataset:")
print(DATASET_PATH)


WORDS_TO_TEST = discover_words()

print("\nAutomatically discovered words:")
print(
    f"Total classes: {len(WORDS_TO_TEST)}"
)

for word in WORDS_TO_TEST:
    print(
        f"  - {word}"
    )


print("\nSigners:")
print(
    f"{SIGNERS_TO_TEST[0]} -> "
    f"{SIGNERS_TO_TEST[-1]}"
)

print(
    "\nInitial sample count:",
    INITIAL_SAMPLE_COUNT
)

print(
    "Final sequence length:",
    SEQUENCE_LENGTH
)

print(
    "Minimum detection ratio:",
    MIN_DETECTION_RATIO
)


# ============================================================
# DATA STORAGE
# ============================================================

X = []
y = []

video_names = []
signers = []

detection_ratios = []


total_candidates = 0
accepted_videos = 0
rejected_videos = 0


# ============================================================
# PROCESS WORDS
# ============================================================

for word in WORDS_TO_TEST:

    word_dir = os.path.join(
        DATASET_PATH,
        word
    )

    print("\n" + "-" * 60)
    print(
        f"WORD: {word}"
    )

    if not os.path.isdir(word_dir):

        print(
            "WARNING: Missing folder"
        )

        continue


    json_files = [
        f
        for f in os.listdir(word_dir)
        if f.lower().endswith(".json")
    ]

    if not json_files:

        print(
            "No JSON metadata files found."
        )

        continue


    # ========================================================
    # PROCESS EACH VIDEO
    # ========================================================

    for json_name in sorted(json_files):

        json_path = os.path.join(
            word_dir,
            json_name
        )


        # ----------------------------------------------------
        # READ METADATA
        # ----------------------------------------------------

        try:

            with open(
                json_path,
                "r",
                encoding="utf-8"
            ) as f:

                metadata = json.load(f)

        except Exception as e:

            print(
                f"  WARNING: Could not read "
                f"{json_name}: {e}"
            )

            continue


        signer = metadata.get(
            "signer"
        )


        # ----------------------------------------------------
        # SIGNER FILTER
        # ----------------------------------------------------

        if signer not in SIGNERS_TO_TEST:
            continue


        total_candidates += 1


        # ----------------------------------------------------
        # FIND VIDEO
        # ----------------------------------------------------

        video_path, video_name = (
            find_video_for_json(
                word_dir,
                json_name
            )
        )


        if video_path is None:

            print(
                f"  REJECTED: Missing video "
                f"for {json_name}"
            )

            rejected_videos += 1

            continue


        # ----------------------------------------------------
        # READ MORE FRAMES
        # ----------------------------------------------------

        frames = read_video_frames(
            video_path
        )


        if len(frames) < SEQUENCE_LENGTH:

            print(
                f"  REJECTED: {video_name} "
                f"(only {len(frames)} frames)"
            )

            rejected_videos += 1

            continue


        # ----------------------------------------------------
        # EXTRACT LANDMARKS
        # ----------------------------------------------------

        all_features = []
        all_detected = []


        for frame in frames:

            features, found = (
                extract_frame_landmarks(
                    frame
                )
            )

            all_features.append(
                features
            )

            all_detected.append(
                found
            )


        all_features = np.asarray(
            all_features,
            dtype=np.float32
        )

        all_detected = np.asarray(
            all_detected,
            dtype=bool
        )


        # ----------------------------------------------------
        # DETECTION RATIO
        # ----------------------------------------------------

        detection_count = np.sum(
            all_detected
        )

        detection_ratio = (
            detection_count /
            len(all_detected)
        )


        # ----------------------------------------------------
        # QUALITY FILTER
        # ----------------------------------------------------

        if (
            detection_ratio <
            MIN_DETECTION_RATIO
        ):

            print(
                f"  REJECTED: {video_name} "
                f"[{signer}] "
                f"({detection_count}/"
                f"{len(all_detected)} detected = "
                f"{detection_ratio * 100:.1f}%)"
            )

            rejected_videos += 1

            continue


        # ----------------------------------------------------
        # SELECT BEST 30 FRAMES
        # ----------------------------------------------------

        sequence, selected_detected = (
            select_best_sequence(
                all_features,
                all_detected
            )
        )


        if sequence is None:

            print(
                f"  REJECTED: Could not create "
                f"{SEQUENCE_LENGTH}-frame sequence"
            )

            rejected_videos += 1

            continue


        # ----------------------------------------------------
        # FINAL SAFETY CHECK
        # ----------------------------------------------------

        sequence = np.asarray(
            sequence,
            dtype=np.float32
        )


        if sequence.shape != (
            SEQUENCE_LENGTH,
            126
        ):

            print(
                f"  REJECTED: Invalid shape "
                f"{sequence.shape}"
            )

            rejected_videos += 1

            continue


        # ----------------------------------------------------
        # SAVE SAMPLE
        # ----------------------------------------------------

        X.append(
            sequence
        )

        y.append(
            word
        )

        video_names.append(
            video_name
        )

        signers.append(
            signer
        )

        detection_ratios.append(
            detection_ratio
        )

        accepted_videos += 1


        print(
            f"  ACCEPTED: {video_name} "
            f"[{signer}] "
            f"({detection_count}/"
            f"{len(all_detected)} detected = "
            f"{detection_ratio * 100:.1f}%)"
        )


# ============================================================
# RESULTS
# ============================================================

print("\n" + "=" * 60)
print("V4 EXTRACTION COMPLETE")
print("=" * 60)

print(
    "Candidate videos:",
    total_candidates
)

print(
    "Accepted videos:",
    accepted_videos
)

print(
    "Rejected videos:",
    rejected_videos
)


# ============================================================
# SAVE DATASET
# ============================================================

if accepted_videos > 0:

    X = np.asarray(
        X,
        dtype=np.float32
    )

    y = np.asarray(
        y
    )

    video_names = np.asarray(
        video_names
    )

    signers = np.asarray(
        signers
    )

    detection_ratios = np.asarray(
        detection_ratios,
        dtype=np.float32
    )


    print("\nFinal shapes:")

    print(
        "X:",
        X.shape
    )

    print(
        "y:",
        y.shape
    )

    print(
        "video_names:",
        video_names.shape
    )

    print(
        "signers:",
        signers.shape
    )

    print(
        "detection_ratios:",
        detection_ratios.shape
    )


    # ========================================================
    # CLASS DISTRIBUTION
    # ========================================================

    print("\nClass distribution:")

    for word in WORDS_TO_TEST:

        count = np.sum(
            y == word
        )

        print(
            f"  {word}: {count}"
        )


    # ========================================================
    # SIGNER DISTRIBUTION
    # ========================================================

    print("\nSigner distribution:")

    for signer in SIGNERS_TO_TEST:

        count = np.sum(
            signers == signer
        )

        print(
            f"  {signer}: {count}"
        )


    # ========================================================
    # DETECTION STATISTICS
    # ========================================================

    print(
        "\nAverage detection ratio:"
    )

    print(
        f"  "
        f"{np.mean(detection_ratios) * 100:.2f}%"
    )

    print(
        "Minimum detection ratio:"
    )

    print(
        f"  "
        f"{np.min(detection_ratios) * 100:.2f}%"
    )

    print(
        "Maximum detection ratio:"
    )

    print(
        f"  "
        f"{np.max(detection_ratios) * 100:.2f}%"
    )


    # ========================================================
    # SAVE
    # ========================================================

    np.savez_compressed(
        OUTPUT_PATH,
        X=X,
        y=y,
        video_names=video_names,
        signers=signers,
        detection_ratios=detection_ratios
    )


    print("\nSaved to:")

    print(
        OUTPUT_PATH
    )


else:

    print(
        "\nERROR: No videos were accepted."
    )


# ============================================================
# CLEANUP
# ============================================================

hands.close()

print("\nExtraction finished.")