const mongoose = require('mongoose');

const gpsPositionSchema = new mongoose.Schema(
  {
    truckId: { type: String, required: true, index: true },
    driverId: { type: String, index: true },
    manifestId: { type: String, index: true },

    position: {
      lat: { type: Number, required: true },
      lng: { type: Number, required: true },
      altitude: { type: Number },
      accuracy: { type: Number },
      heading: { type: Number },
      speed: { type: Number },
    },

    // Connectivity status
    connectivity: {
      type: String,
      enum: ['online', 'offline', 'weak'],
      default: 'online',
    },

    // If this was recorded offline and synced later
    isOfflineSync: { type: Boolean, default: false },
    recordedAt: { type: Date, required: true },
    syncedAt: { type: Date },

    // Battery level of the device
    batteryLevel: { type: Number },

    // Additional sensor data
    engineStatus: { type: String, enum: ['on', 'off', 'idle'] },
    fuelLevel: { type: Number },
    odometer: { type: Number },

    // Event type
    eventType: {
      type: String,
      enum: ['periodic', 'ignition_on', 'ignition_off', 'geofence_enter', 'geofence_exit', 'sos', 'manual'],
      default: 'periodic',
    },
  },
  {
    timestamps: true,
    timeseries: {
      timeField: 'recordedAt',
      metaField: 'truckId',
      granularity: 'seconds',
    },
  },
);

gpsPositionSchema.index({ truckId: 1, recordedAt: -1 });
gpsPositionSchema.index({ recordedAt: 1 }, { expireAfterSeconds: 90 * 24 * 60 * 60 }); // 90 days TTL

module.exports = mongoose.model('GpsPosition', gpsPositionSchema);
