import { S3Client, PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { config } from '../config.js';

let s3Client = null;
if (config.AWS_ACCESS_KEY_ID && config.AWS_ACCESS_KEY_ID !== 'xxx') {
  s3Client = new S3Client({
    region: config.AWS_REGION,
    credentials: {
      accessKeyId: config.AWS_ACCESS_KEY_ID,
      secretAccessKey: config.AWS_SECRET_ACCESS_KEY,
    },
  });
} else {
  console.warn('AWS S3 credentials are not configured. S3 uploads will return mocked public URLs.');
}

export async function uploadWavFile(callSid, trackName, wavBuffer) {
  const key = `recordings/${callSid}-${trackName}.wav`;
  const bucketName = config.AWS_S3_BUCKET || 'linengrass-recordings';
  const region = config.AWS_REGION || 'us-east-1';
  const publicUrl = `https://${bucketName}.s3.${region}.amazonaws.com/${key}`;

  console.log(`[S3Service] Uploading ${key} to bucket ${bucketName}...`);

  if (!s3Client) {
    console.log(`[S3Service] Mock upload complete. URL: ${publicUrl}`);
    return publicUrl;
  }

  try {
    const command = new PutObjectCommand({
      Bucket: bucketName,
      Key: key,
      Body: wavBuffer,
      ContentType: 'audio/wav',
    });
    await s3Client.send(command);

    // Generate a 7-day presigned URL (604800 seconds)
    const getCommand = new GetObjectCommand({
      Bucket: bucketName,
      Key: key,
    });
    const presignedUrl = await getSignedUrl(s3Client, getCommand, { expiresIn: 604800 });
    console.log(`[S3Service] Upload success. Presigned URL: ${presignedUrl}`);
    return presignedUrl;
  } catch (err) {
    console.error(`[S3Service] Upload failed for ${key}:`, err);
    return publicUrl;
  }
}
