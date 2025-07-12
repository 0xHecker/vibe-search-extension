import { OffscreenRouter } from "@src/services/router";
import { vectorStoreService } from "@src/services/vector-store.service";
import { embeddingService } from "@src/services/embedding.service";

console.log("Offscreen document script loaded.");

const router = new OffscreenRouter();

// Register all the services that the offscreen document will manage.
router.registerService("vectorStore", vectorStoreService);
router.registerService("embedding", embeddingService);
// To add a new service (e.g., for RxDB or image classification),
// you would simply create the service and register it here.
// router.registerService("imageClassifier", imageClassificationService);

// Start listening for messages.
router.listen();
