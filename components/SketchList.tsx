/**
 * SketchList - Displays saved sketches in a grid layout.
 * 
 * Features:
 * - Grid display of sketch thumbnails
 * - Tap to view full-size
 * - Long-press for options (copy, delete)
 * - Sync status indicators
 * - Pull-to-refresh for syncing
 */

import React, { useState, useCallback, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  Image,
  Alert,
  RefreshControl,
  ActivityIndicator,
  Modal,
  Dimensions,
  Share,
} from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { Feather } from '@expo/vector-icons';
import { SketchEntry } from '../types';
import { SketchStorageService } from '../services/sketchStorage';
import { syncAllPendingSketches, deleteRemoteSketch } from '../services/sketchSync';

const { width: SCREEN_WIDTH } = Dimensions.get('window');
const GRID_PADDING = 16;
const GRID_GAP = 12;
const NUM_COLUMNS = 2;
const ITEM_WIDTH = (SCREEN_WIDTH - GRID_PADDING * 2 - GRID_GAP * (NUM_COLUMNS - 1)) / NUM_COLUMNS;

interface SketchListProps {
  sketches: SketchEntry[];
  onRefresh: () => Promise<void>;
  onNewSketch: () => void;
}

export function SketchList({ sketches, onRefresh, onNewSketch }: SketchListProps) {
  const [refreshing, setRefreshing] = useState(false);
  const [selectedSketch, setSelectedSketch] = useState<SketchEntry | null>(null);
  const [isSyncing, setIsSyncing] = useState(false);

  // Pull to refresh handler.
  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      // Sync pending sketches first.
      setIsSyncing(true);
      await syncAllPendingSketches();
      setIsSyncing(false);
      
      // Then refresh the list.
      await onRefresh();
    } catch (error) {
      console.error('Refresh failed:', error);
    } finally {
      setRefreshing(false);
    }
  }, [onRefresh]);

  // Delete a sketch with confirmation.
  const handleDelete = useCallback((sketch: SketchEntry) => {
    Alert.alert(
      'Delete Sketch?',
      'This will permanently delete this sketch from your device and cloud.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            try {
              // Delete locally.
              await SketchStorageService.deleteSketch(sketch.id);
              
              // Delete remotely if synced.
              if (sketch.syncStatus === 'synced') {
                await deleteRemoteSketch(sketch.id);
              }
              
              // Refresh the list.
              await onRefresh();
            } catch (error) {
              console.error('Delete failed:', error);
              Alert.alert('Error', 'Failed to delete sketch. Please try again.');
            }
          },
        },
      ]
    );
  }, [onRefresh]);

  // Copy sketch image to clipboard (iOS 16+ supports image clipboard).
  const handleCopy = useCallback(async (sketch: SketchEntry) => {
    try {
      // On iOS, we can't directly copy images to clipboard in Expo.
      // Instead, we'll share the image.
      await Share.share({
        url: sketch.localUri,
        title: sketch.title || 'Sketch',
      });
    } catch (error) {
      console.error('Share failed:', error);
      Alert.alert('Error', 'Failed to share sketch.');
    }
  }, []);

  // Show options menu on long press.
  const handleLongPress = useCallback((sketch: SketchEntry) => {
    Alert.alert(
      sketch.title || 'Sketch',
      `Created ${new Date(sketch.createdAt).toLocaleString()}`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Share', onPress: () => handleCopy(sketch) },
        { text: 'Delete', style: 'destructive', onPress: () => handleDelete(sketch) },
      ]
    );
  }, [handleCopy, handleDelete]);

  // Render sync status badge.
  const renderSyncBadge = (status: SketchEntry['syncStatus']) => {
    switch (status) {
      case 'pending':
        return (
          <View style={[styles.syncBadge, styles.syncPending]}>
            <Feather name="upload-cloud" size={12} color="#FF9500" />
          </View>
        );
      case 'syncing':
        return (
          <View style={[styles.syncBadge, styles.syncPending]}>
            <ActivityIndicator size="small" color="#007AFF" />
          </View>
        );
      case 'synced':
        return (
          <View style={[styles.syncBadge, styles.syncSynced]}>
            <Feather name="check" size={12} color="#34C759" />
          </View>
        );
      case 'failed':
        return (
          <View style={[styles.syncBadge, styles.syncFailed]}>
            <Feather name="alert-circle" size={12} color="#FF3B30" />
          </View>
        );
      default:
        return null;
    }
  };

  // Render a single sketch grid item.
  const renderItem = ({ item }: { item: SketchEntry }) => (
    <TouchableOpacity
      style={styles.gridItem}
      onPress={() => setSelectedSketch(item)}
      onLongPress={() => handleLongPress(item)}
      activeOpacity={0.7}
    >
      <Image
        source={{ uri: item.localUri }}
        style={styles.thumbnail}
        resizeMode="cover"
      />
      {renderSyncBadge(item.syncStatus)}
      {item.title && (
        <View style={styles.titleOverlay}>
          <Text style={styles.titleText} numberOfLines={1}>
            {item.title}
          </Text>
        </View>
      )}
    </TouchableOpacity>
  );

  // Render empty state.
  const renderEmpty = () => (
    <View style={styles.emptyState}>
      <Feather name="edit-3" size={48} color="#8E8E93" />
      <Text style={styles.emptyTitle}>No Sketches Yet</Text>
      <Text style={styles.emptySubtitle}>
        Tap the + button to create your first sketch
      </Text>
      <TouchableOpacity style={styles.createButton} onPress={onNewSketch}>
        <Feather name="plus" size={20} color="#fff" />
        <Text style={styles.createButtonText}>New Sketch</Text>
      </TouchableOpacity>
    </View>
  );

  // Render header with sync indicator.
  const renderHeader = () => (
    <View style={styles.header}>
      <Text style={styles.headerTitle}>Sketches</Text>
      {isSyncing && (
        <View style={styles.syncIndicator}>
          <ActivityIndicator size="small" color="#007AFF" />
          <Text style={styles.syncingText}>Syncing...</Text>
        </View>
      )}
    </View>
  );

  return (
    <View style={styles.container}>
      <FlatList
        data={sketches}
        keyExtractor={(item) => item.id}
        renderItem={renderItem}
        numColumns={NUM_COLUMNS}
        contentContainerStyle={styles.listContent}
        columnWrapperStyle={styles.columnWrapper}
        ListHeaderComponent={renderHeader}
        ListEmptyComponent={renderEmpty}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={handleRefresh}
            tintColor="#007AFF"
          />
        }
      />

      {/* Floating action button for new sketch */}
      {sketches.length > 0 && (
        <TouchableOpacity style={styles.fab} onPress={onNewSketch}>
          <Feather name="plus" size={28} color="#fff" />
        </TouchableOpacity>
      )}

      {/* Full-size preview modal */}
      <Modal
        visible={!!selectedSketch}
        animationType="fade"
        transparent
        onRequestClose={() => setSelectedSketch(null)}
      >
        <TouchableOpacity
          style={styles.modalOverlay}
          activeOpacity={1}
          onPress={() => setSelectedSketch(null)}
        >
          <View style={styles.modalContent}>
            {selectedSketch && (
              <>
                <Image
                  source={{ uri: selectedSketch.localUri }}
                  style={styles.fullImage}
                  resizeMode="contain"
                />
                <View style={styles.modalActions}>
                  <TouchableOpacity
                    style={styles.modalAction}
                    onPress={() => {
                      setSelectedSketch(null);
                      handleCopy(selectedSketch);
                    }}
                  >
                    <Feather name="share" size={24} color="#fff" />
                    <Text style={styles.modalActionText}>Share</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={styles.modalAction}
                    onPress={() => {
                      setSelectedSketch(null);
                      handleDelete(selectedSketch);
                    }}
                  >
                    <Feather name="trash-2" size={24} color="#FF3B30" />
                    <Text style={[styles.modalActionText, { color: '#FF3B30' }]}>
                      Delete
                    </Text>
                  </TouchableOpacity>
                </View>
              </>
            )}
          </View>
        </TouchableOpacity>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F5F5F5',
  },
  listContent: {
    paddingHorizontal: GRID_PADDING,
    paddingBottom: 100, // Space for FAB
  },
  columnWrapper: {
    gap: GRID_GAP,
    marginBottom: GRID_GAP,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 16,
  },
  headerTitle: {
    fontSize: 28,
    fontWeight: 'bold',
    color: '#000',
  },
  syncIndicator: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  syncingText: {
    fontSize: 13,
    color: '#007AFF',
  },
  gridItem: {
    width: ITEM_WIDTH,
    aspectRatio: 1,
    borderRadius: 12,
    overflow: 'hidden',
    backgroundColor: '#2C2C2E',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  thumbnail: {
    width: '100%',
    height: '100%',
  },
  syncBadge: {
    position: 'absolute',
    top: 8,
    right: 8,
    width: 24,
    height: 24,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  syncPending: {
    backgroundColor: 'rgba(255, 149, 0, 0.2)',
  },
  syncSynced: {
    backgroundColor: 'rgba(52, 199, 89, 0.2)',
  },
  syncFailed: {
    backgroundColor: 'rgba(255, 59, 48, 0.2)',
  },
  titleOverlay: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: 'rgba(0, 0, 0, 0.6)',
    paddingHorizontal: 8,
    paddingVertical: 6,
  },
  titleText: {
    fontSize: 12,
    color: '#fff',
    fontWeight: '500',
  },
  emptyState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingTop: 80,
    paddingHorizontal: 32,
  },
  emptyTitle: {
    fontSize: 20,
    fontWeight: '600',
    color: '#000',
    marginTop: 16,
    marginBottom: 8,
  },
  emptySubtitle: {
    fontSize: 15,
    color: '#8E8E93',
    textAlign: 'center',
    marginBottom: 24,
  },
  createButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#007AFF',
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 10,
    gap: 8,
  },
  createButtonText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#fff',
  },
  fab: {
    position: 'absolute',
    bottom: 24,
    right: 24,
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: '#007AFF',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 8,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.9)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  modalContent: {
    width: '100%',
    alignItems: 'center',
    paddingHorizontal: 16,
  },
  fullImage: {
    width: SCREEN_WIDTH - 32,
    height: SCREEN_WIDTH - 32,
    borderRadius: 12,
  },
  modalActions: {
    flexDirection: 'row',
    marginTop: 24,
    gap: 40,
  },
  modalAction: {
    alignItems: 'center',
    gap: 8,
  },
  modalActionText: {
    fontSize: 14,
    color: '#fff',
    fontWeight: '500',
  },
});
