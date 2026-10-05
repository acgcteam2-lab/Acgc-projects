import cloudinaryPackage from "cloudinary";
import process from "node:process";

const cloudinary = cloudinaryPackage.v2;

export const getCloudinaryConfig = (env = process.env) => {
  const cloudinaryUrl = env.CLOUDINARY_URL?.trim();

  if (cloudinaryUrl) {
    try {
      const parsedUrl = new URL(cloudinaryUrl);
      const config = {
        cloud_name: parsedUrl.hostname,
        api_key: decodeURIComponent(parsedUrl.username),
        api_secret: decodeURIComponent(parsedUrl.password),
      };

      if (parsedUrl.protocol !== "cloudinary:" || Object.values(config).some((value) => !value)) {
        throw new Error();
      }

      return config;
    } catch {
      const error = new Error("CLOUDINARY_URL must match cloudinary://<api_key>:<api_secret>@<cloud_name>.");
      error.status = 503;
      throw error;
    }
  }

  const config = {
    cloud_name: env.CLOUDINARY_CLOUD_NAME?.trim(),
    api_key: env.CLOUDINARY_API_KEY?.trim(),
    api_secret: env.CLOUDINARY_API_SECRET?.trim(),
  };

  if (Object.values(config).some((value) => !value)) {
    const error = new Error("Set CLOUDINARY_URL or all three CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, and CLOUDINARY_API_SECRET variables.");
    error.status = 503;
    throw error;
  }

  return config;
};

export const uploadImageBuffer = (buffer, { folder }) => {
  cloudinary.config(getCloudinaryConfig());

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