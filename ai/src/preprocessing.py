def normalize_landmarks(landmarks):
    """
    Normalize hand landmarks relative to the wrist
    and scale them so hand size has less effect.
    """

    wrist = landmarks[0]

    # Move wrist to (0, 0, 0)
    relative_landmarks = []

    for landmark in landmarks:
        x = landmark.x - wrist.x
        y = landmark.y - wrist.y
        z = landmark.z - wrist.z

        relative_landmarks.append([x, y, z])

    # Find the largest absolute coordinate
    max_value = max(
        abs(value)
        for landmark in relative_landmarks
        for value in landmark
    )

    # Avoid division by zero
    if max_value == 0:
        max_value = 1

    # Scale coordinates
    normalized = []

    for landmark in relative_landmarks:
        for value in landmark:
            normalized.append(value / max_value)

    return normalized
if __name__ == "__main__":

    class Landmark:
        def __init__(self, x, y, z):
            self.x = x
            self.y = y
            self.z = z

    # Create 21 fake landmarks
    test_landmarks = []

    for i in range(21):
        test_landmarks.append(
            Landmark(
                x=0.5 + i * 0.01,
                y=0.5 + i * 0.01,
                z=i * 0.01
            )
        )

    result = normalize_landmarks(test_landmarks)

    print("Number of features:", len(result))
    print("Normalized landmarks:")
    print(result)
