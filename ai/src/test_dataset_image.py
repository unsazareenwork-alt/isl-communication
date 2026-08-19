import cv2
import mediapipe as mp

IMAGE_PATH = r"C:\Users\goyal\Documents\isl-datasets\Static gestures of Indian Sign Language (ISL) for English Alphabet, Hindi Vowels and Numerals\ISL Images\3. Adults ISL Images\Adults ISL images in Full Sleeves\English Alphabet\C\C (1).jpg"
mp_hands = mp.solutions.hands
mp_draw = mp.solutions.drawing_utils

hands = mp_hands.Hands(
    static_image_mode=True,
    max_num_hands=2,
    min_detection_confidence=0.5
)

image = cv2.imread(IMAGE_PATH)

if image is None:
    print("Could not load image.")
    exit()

image_rgb = cv2.cvtColor(image, cv2.COLOR_BGR2RGB)

results = hands.process(image_rgb)

if results.multi_hand_landmarks:
    print("Hand detected!")
    print("Number of hands:", len(results.multi_hand_landmarks))

    for hand_landmarks in results.multi_hand_landmarks:
        mp_draw.draw_landmarks(
            image,
            hand_landmarks,
            mp_hands.HAND_CONNECTIONS
        )

else:
    print("No hand detected.")

cv2.imshow("Dataset Image", image)

cv2.waitKey(0)
cv2.destroyAllWindows()

hands.close()