require('dotenv').config();
const cloudinary = require('./config/cloudinary');

const getPublicIdFromUrl = (url) => {
  if (typeof url !== 'string') return null;
  const match = url.match(/\/v\d+\/(cirql\/.+?)(?:\.\w+)?$/);
  return match ? match[1] : null;
};

const destroyCloudinaryImages = (listingOrFiles, requestId) => {
  const publicIds = new Set();
  for (const image of listingOrFiles?.images || []) {
    const publicId = typeof image === 'string' ? getPublicIdFromUrl(image) : image?.publicId;
    if (publicId) publicIds.add(publicId);
  }
  
  const ids = [...publicIds];
  console.log('Public IDs to delete:', ids);
  if (ids.length === 0) return;

  return Promise.all(ids.map(publicId => {
    console.log('Destroying', publicId);
    return cloudinary.uploader.destroy(publicId, { invalidate: true })
      .then(res => console.log('Destroy result for', publicId, res));
  })).catch(console.error);
};

const mockListing = {
  images: [
    'https://res.cloudinary.com/dtpijqtdq/image/upload/v1777806809/cirql/listings/listing-1777806803676-45bf98b3-1534-460f-baa1-99295218ed04.png'
  ]
};

destroyCloudinaryImages(mockListing).then(() => console.log('Done'));
