/**
 * IPC channels for social functionality (DMs, Feedback, Contacts, Hot Mic).
 */
export const SocialIPCChannels = {
  // DM operations
  SEND_DM: 'social:sendDM',
  SEND_TEXT_DM: 'social:sendTextDM',
  SEND_IMAGE_REPLY: 'social:sendImageReply',
  GET_CONVERSATIONS: 'social:getConversations',
  GET_DMS_WITH_USER: 'social:getDMsWithUser',
  MARK_AS_READ: 'social:markAsRead',
  MARK_AS_READ_BATCH: 'social:markAsReadBatch',
  HAS_UNREAD: 'social:hasUnread',
  HAS_UNREAD_FEEDBACK: 'social:hasUnreadFeedback',
  MARK_ALL_FEEDBACK_AS_READ: 'social:markAllFeedbackAsRead',

  // Feedback operations
  SUBMIT_FEEDBACK: 'social:submitFeedback',
  SUBMIT_TEXT_FEEDBACK: 'social:submitTextFeedback',
  SUBMIT_IMAGE_FEEDBACK: 'social:submitImageFeedback',
  GET_MY_FEEDBACK: 'social:getMyFeedback',
  GET_ALL_FEEDBACK: 'social:getAllFeedback',
  GET_FEEDBACK_REPLIES: 'social:getFeedbackReplies',
  UPDATE_FEEDBACK_STATUS: 'social:updateFeedbackStatus',
  GET_ACTIVITY_LOG: 'social:getActivityLog',
  
  // Contact operations
  GET_CONTACTS: 'social:getContacts',
  ADD_FRIEND: 'social:addFriend',
  SEARCH_CONTACTS: 'social:searchContacts',
  GET_PENDING_INVITES: 'social:getPendingInvites',
  RESPOND_TO_INVITE: 'social:respondToInvite',
  REMOVE_FRIEND: 'social:removeFriend',
  
  // Hot mic
  GET_HOT_MIC: 'social:getHotMic',
  SET_HOT_MIC: 'social:setHotMic',
  
  // Admin check
  IS_ADMIN: 'social:isAdmin',
  
  // Events
  MESSAGE_RECEIVED: 'social:messageReceived',
} as const;

