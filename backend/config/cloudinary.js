import cloudinaryPackage from "cloudinary";
import process from "node:process";

const cloudinary = cloudinaryPackage.v2;

export const getCloudinaryConfig = (env = process.env) => {
  const splitConfig = {
    cloud_name: env.CLOUDINARY_CLOUD_NAME?.trim(),
    api_key: env.CLOUDINARY_API_KEY?.trim(),
    api_secret: env.CLOUDINARY_API_SECRET?.trim(),
  };

  if (Object.values(splitConfig).every(Boolean)) return splitConfig;

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

  const error = new Error("Set CLOUDINARY_URL or all three CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, and CLOUDINARY_API_SECRET variables.");
  error.status = 503;
  throw error;
};

export const createCloudinaryUploadSignature = ({ folder, publicId, resourceType = "auto", type = "upload" }) => {
  const config = getCloudinaryConfig();
  const timestamp = Math.floor(Date.now() / 1000);
  const params = { folder, public_id: publicId, timestamp };
  if (type !== "upload") params.type = type;

  return {
    apiKey: config.api_key,
    cloudName: config.cloud_name,
    folder,
    publicId,
    resourceType,
    timestamp,
    type,
    signature: cloudinary.utils.api_sign_request(params, config.api_secret),
  };
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

export const uploadMediaBuffer = (buffer, { folder }) => {
  cloudinary.config(getCloudinaryConfig());

  return new Promise((resolve, reject) => {
    const uploadStream = cloudinary.uploader.upload_stream(
      { folder, resource_type: "auto", unique_filename: true },
      (error, result) => {
        if (error) return reject(error);
        if (!result?.secure_url) return reject(new Error("Cloudinary did not return an uploaded file URL."));
        return resolve(result);
      }
    );
    uploadStream.end(buffer);
  });
};

export const uploadPrivateRawBuffer = (buffer, publicId) => {
  cloudinary.config(getCloudinaryConfig());

  return new Promise((resolve, reject) => {
    if (typeof cloudinary.uploader.upload_chunked_stream !== "function") {
      return reject(new Error("Installed Cloudinary SDK does not support chunked raw uploads."));
    }

    const uploadStream = cloudinary.uploader.upload_chunked_stream(
      {
        public_id: publicId,
        resource_type: "raw",
        type: "authenticated",
        overwrite: true,
        unique_filename: false,
        chunk_size: 20_000_000,
      },
      (error, result) => {
        if (error) return reject(error);
        if (!result?.public_id) return reject(new Error("Cloudinary did not return an archive ID."));
        return resolve(result);
      }
    );
    uploadStream.end(buffer);
  });
};

export const getPrivateRawDownloadUrl = (publicId, format) => {
  cloudinary.config(getCloudinaryConfig());
  return cloudinary.utils.private_download_url(publicId, format, {
    resource_type: "raw",
    type: "authenticated",
    attachment: true,
  });
};

export const deletePrivateRawAsset = (publicId) => {
  cloudinary.config(getCloudinaryConfig());
  return cloudinary.uploader.destroy(publicId, {
    resource_type: "raw",
    type: "authenticated",
    invalidate: true,
  });
};
