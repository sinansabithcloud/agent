module.exports = {
  ROLES: {
    ADMIN: 'admin',
    DISPATCHER: 'dispatcher',
    DRIVER: 'driver',
    INSPECTOR: 'inspector',
    VIEWER: 'viewer',
  },

  TRUCK_STATUS: {
    IDLE: 'idle',
    IN_TRANSIT: 'in_transit',
    LOADING: 'loading',
    UNLOADING: 'unloading',
    MAINTENANCE: 'maintenance',
    OFFLINE: 'offline',
  },

  MANIFEST_STATUS: {
    DRAFT: 'draft',
    PENDING_REVIEW: 'pending_review',
    APPROVED: 'approved',
    IN_TRANSIT: 'in_transit',
    DELIVERED: 'delivered',
    REJECTED: 'rejected',
  },

  OCR_STATUS: {
    PENDING: 'pending',
    PROCESSING: 'processing',
    COMPLETED: 'completed',
    FAILED: 'failed',
    NEEDS_REVIEW: 'needs_review',
  },

  GPS_EVENT: {
    POSITION_UPDATE: 'gps.position.update',
    GEOFENCE_ENTER: 'gps.geofence.enter',
    GEOFENCE_EXIT: 'gps.geofence.exit',
    CONNECTION_LOST: 'gps.connection.lost',
    CONNECTION_RESTORED: 'gps.connection.restored',
    OFFLINE_SYNC: 'gps.offline.sync',
  },

  EVENTS: {
    USER_CREATED: 'user.created',
    USER_UPDATED: 'user.updated',
    MANIFEST_CREATED: 'manifest.created',
    MANIFEST_APPROVED: 'manifest.approved',
    MANIFEST_DELIVERED: 'manifest.delivered',
    OCR_COMPLETED: 'ocr.completed',
    QR_SCANNED: 'qr.scanned',
    TRUCK_DEPARTED: 'truck.departed',
    TRUCK_ARRIVED: 'truck.arrived',
    REPORT_GENERATED: 'report.generated',
  },

  EXCHANGES: {
    USERS: 'tawseelq.users',
    MANIFESTS: 'tawseelq.manifests',
    GPS: 'tawseelq.gps',
    OCR: 'tawseelq.ocr',
    QR: 'tawseelq.qr',
    REPORTS: 'tawseelq.reports',
  },
};
