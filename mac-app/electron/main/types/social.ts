/**
 * IPC channels for social functionality (DMs, Feedback, Contacts, Hot Mic).
 */
export const SocialIPCChannels = {
  // DM operations
  SEND_DM: 'social:sendDM',
  SEND_TEXT_DM: 'social:sendTextDM',
  GET_CONVERSATIONS: 'social:getConversations',
  GET_DMS_WITH_USER: 'social:getDMsWithUser',
  MARK_AS_READ: 'social:markAsRead',
  HAS_UNREAD: 'social:hasUnread',
  
  // Feedback operations
  SUBMIT_FEEDBACK: 'social:submitFeedback',
  GET_MY_FEEDBACK: 'social:getMyFeedback',
  GET_ALL_FEEDBACK: 'social:getAllFeedback',
  GET_FEEDBACK_REPLIES: 'social:getFeedbackReplies',
  UPDATE_FEEDBACK_STATUS: 'social:updateFeedbackStatus',
  GET_ACTIVITY_LOG: 'social:getActivityLog',
  
  // Contact operations
  GET_CONTACTS: 'social:getContacts',
  ADD_FRIEND: 'social:addFriend',
  SEARCH_CONTACTS: 'social:searchContacts',
  
  // Hot mic
  GET_HOT_MIC: 'social:getHotMic',
  SET_HOT_MIC: 'social:setHotMic',
  
  // Admin check
  IS_ADMIN: 'social:isAdmin',
  
  // Events
  MESSAGE_RECEIVED: 'social:messageReceived',
} as const;

