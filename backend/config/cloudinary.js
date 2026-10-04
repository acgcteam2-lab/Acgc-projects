import cloudinaryPackage from "cloudinary";
import process from "node:process";

const cloudinary = cloudinaryPackage.v2;

export const uploadImageBuffer = (buffer, { folder }) => {
  const cloudName = process.env.CLOUDINARY_CLOUD_NAME;
  const apiKey = process.env.CLOUDINARY_API_KEY;
  const apiSecret = process.env.CLOUDINARY_API_SECRET;

  if (!cloudName || !apiKey || !apiSecret) {
    const error = new Error("Cloudinary is not configured on the backend.");
    error.status = 503;
    throw error;
  }

  cloudinary.config({
    cloud_name: cloudName,
    api_key: apiKey,
    api_secret: apiSecret,
  });

  return new Promise((resolve, reject) => {
    const uploadStream = cloudinary.uploader.upload_stream(
      { folder, resource_type: "image", unique_filename: true },
      (error, result) => {
        if (error) return reject(error);
        if (!result?.secure_url) return reject(new Error("Cloudinary did not return an image URL."));
        return resolve(result);
      }
    );
    uploadStream.end(buffer);
  });
};