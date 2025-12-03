import { EventEmitter } from 'events';
import { spawn, ChildProcess } from 'child_process';
import { app } from 'electron';
import path from 'path';
import fs from 'fs/promises';
import { VisionModelManager, VisionModelSize } from './visionModelManager';
import { ClipboardManager } from './clipboardManager';

/**
 * Events emitted by VisionProcessor.
 */
export interface VisionProcessorEvents {
  descriptionReady: (itemId: number, description: string) => void;
  error: (itemId: number, error: Error) => void;
}

/**
 * Manages background image captioning using MLX vision models.
 * Processes images in a queue and updates clipboard items with descriptions.
 */
export class VisionProcessor extends EventEmitter {
  private modelManager: VisionModelManager;
  private clipboardManager: ClipboardManager;
  private processingQueue: number[] = [];
  private isProcessing: boolean = false;
  private currentProcess: ChildProcess | null = null;

  constructor(modelManager: VisionModelManager, clipboardManager: ClipboardManager) {
    super();
    this.modelManager = modelManager;
    this.clipboardManager = clipboardManager;
  }

  /**
   * Queue an image item for processing.
   * Processing happens asynchronously in the background.
   */
  async queueImage(itemId: number): Promise<void> {
    // Check if model is available
    const isAvailable = await this.modelManager.isModelAvailable();
    if (!isAvailable) {
      console.log(`[VisionProcessor] Model not available, skipping item ${itemId}`);
      return;
    }

    // Check if item already has content (already processed)
    const item = this.clipboardManager.getItem(itemId);
    if (item && item.content) {
      console.log(`[VisionProcessor] Item ${itemId} already has content, skipping`);
      return;
    }

    // Check if item is an image or screenshot
    if (!item || (item.type !== 'image' && item.type !== 'screenshot')) {
      console.log(`[VisionProcessor] Item ${itemId} is not an image, skipping`);
      return;
    }

    // Add to queue if not already there
    if (!this.processingQueue.includes(itemId)) {
      this.processingQueue.push(itemId);
      console.log(`[VisionProcessor] Queued item ${itemId} for processing`);
    }

    // Start processing if not already running
    if (!this.isProcessing) {
      this.processQueue();
    }
  }

  /**
   * Process the queue of pending images.
   */
  private async processQueue(): Promise<void> {
    if (this.isProcessing || this.processingQueue.length === 0) {
      return;
    }

    this.isProcessing = true;

    while (this.processingQueue.length > 0) {
      const itemId = this.processingQueue.shift()!;
      
      try {
        await this.processImage(itemId);
      } catch (error) {
        console.error(`[VisionProcessor] Error processing item ${itemId}:`, error);
        this.emit('error', itemId, error instanceof Error ? error : new Error(String(error)));
      }
    }

    this.isProcessing = false;
  }

  /**
   * Process a single image item.
   */
  private async processImage(itemId: number): Promise<void> {
    const item = this.clipboardManager.getItem(itemId);
    if (!item || !item.imageData) {
      throw new Error(`Item ${itemId} not found or has no image data`);
    }

    // Save image to temporary file
    const tempDir = app.getPath('temp');
    const imagePath = path.join(tempDir, `vision_${itemId}_${Date.now()}.png`);
    await fs.writeFile(imagePath, item.imageData);

    try {
      // Generate description using MLX vision model
      const description = await this.generateDescription(imagePath);
      
      // Update clipboard item with description
      // Format: "Screenshot - [description]" for screenshots, or just description for images
      const formattedDescription = item.type === 'screenshot' 
        ? `Screenshot - ${description}`
        : description;
      
      this.clipboardManager.updateItemContent(itemId, formattedDescription);
      
      console.log(`[VisionProcessor] Generated description for item ${itemId}: ${description}`);
      this.emit('descriptionReady', itemId, formattedDescription);
    } finally {
      // Clean up temporary file
      try {
        await fs.unlink(imagePath);
      } catch {
        // Ignore cleanup errors
      }
    }
  }

  /**
   * Generate a brief description of an image using the MLX vision model.
   */
  private async generateDescription(imagePath: string): Promise<string> {
    const modelPath = this.modelManager.getModelPath();
    const modelSize = this.modelManager.getSelectedModel();
    
    // Use Python with mlx-vlm to generate description
    // Command: python -m mlx_vlm.generate --model <model_path> --image <image_path> --prompt "Describe this image briefly."
    const scriptPath = path.join(app.getPath('temp'), 'generate_vision_caption.py');
    const scriptContent = `
import sys
import json
from mlx_vlm import load, generate

model_path = "${modelPath}"
image_path = "${imagePath}"
prompt = "Describe this image briefly in one sentence."

try:
    model, processor = load(model_path)
    response = generate(model, processor, image_path, prompt, max_tokens=100)
    print(json.dumps({"success": True, "description": response}))
except Exception as e:
    print(json.dumps({"success": False, "error": str(e)}), file=sys.stderr)
    sys.exit(1)
`;

    await fs.writeFile(scriptPath, scriptContent);

    return new Promise((resolve, reject) => {
      const pythonCmd = process.platform === 'darwin' ? 'python3' : 'python';
      this.currentProcess = spawn(pythonCmd, [scriptPath], {
        env: { ...process.env, PYTHONUNBUFFERED: '1' }
      });

      if (!this.currentProcess) {
        reject(new Error('Failed to spawn Python process'));
        return;
      }

      let stdout = '';
      let stderr = '';

      this.currentProcess.stdout?.on('data', (data: Buffer) => {
        stdout += data.toString();
      });

      this.currentProcess.stderr?.on('data', (data: Buffer) => {
        stderr += data.toString();
      });

      this.currentProcess.on('close', async (code) => {
        try {
          await fs.unlink(scriptPath);
        } catch {
          // Ignore cleanup errors
        }

        this.currentProcess = null;

        if (code !== 0) {
          reject(new Error(`Vision model inference failed: ${stderr || stdout}`));
          return;
        }

        try {
          // Try to parse JSON response
          const lines = stdout.trim().split('\n');
          const jsonLine = lines.find(line => line.startsWith('{'));
          if (jsonLine) {
            const result = JSON.parse(jsonLine);
            if (result.success && result.description) {
              // Clean up the description - remove any extra formatting
              let description = result.description.trim();
              // Remove quotes if present
              if ((description.startsWith('"') && description.endsWith('"')) ||
                  (description.startsWith("'") && description.endsWith("'"))) {
                description = description.slice(1, -1);
              }
              resolve(description);
            } else {
              reject(new Error(result.error || 'Unknown error'));
            }
          } else {
            // Fallback: use stdout as description
            const description = stdout.trim();
            if (description) {
              resolve(description);
            } else {
              reject(new Error('No description generated'));
            }
          }
        } catch (parseError) {
          // If JSON parsing fails, try to extract description from stdout
          const description = stdout.trim();
          if (description) {
            resolve(description);
          } else {
            reject(new Error(`Failed to parse response: ${parseError}`));
          }
        }
      });

      this.currentProcess.on('error', (error) => {
        this.currentProcess = null;
        reject(new Error(`Failed to start Python process: ${error.message}. Make sure Python and mlx-vlm are installed.`));
      });
    });
  }

  /**
   * Cancel any ongoing processing.
   */
  cancel(): void {
    if (this.currentProcess) {
      this.currentProcess.kill();
      this.currentProcess = null;
    }
    this.processingQueue = [];
    this.isProcessing = false;
  }
}

