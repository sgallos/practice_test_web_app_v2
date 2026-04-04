window.PRACTICE_TEST_DEFAULT_MANIFEST = "./manifests/exam-1.json";

window.PRACTICE_TEST_EXAMS = {
  "sample-exam": {
    id: "sample-exam",
    title: "Sample Image Practice Exam",
    description: "A small built-in sample exam that demonstrates the manifest-first image-based player flow.",
    version: "1.0.0",
    durationMinutes: 60,
    adminResetToken: "80aa2e8f-31be-4073-9c99-386015d03bb2",
    startAccessToken: "dd4d17f1-a05d-4f03-b954-2527df51cf75",
    questions: [
      {
        id: 2,
        promptImage: "./assets/sample-exam/q002__front__text.png",
        figureImage: null,
        answerKeyImage: "./assets/sample-exam/q002__back__answer.png",
        correct: "a",
      },
      {
        id: 24,
        promptImage: "./assets/sample-exam/q024__front__qblock.png",
        figureImage: "./assets/sample-exam/q024__front__img.png",
        answerKeyImage: "./assets/sample-exam/q024__back__answer.png",
        correct: "a",
      },
    ],
  },
};
