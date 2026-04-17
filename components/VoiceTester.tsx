import * as Clipboard from 'expo-clipboard';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  TouchableOpacity,
  View,
  NativeModules,
} from 'react-native';

type NativeVoice = {
  id: string;
  name: string;
  language: string;
  quality: number;
  traits: number;
  isEloquence: boolean;
  isLegacyNovelty: boolean;
  isSuperCompact: boolean;
  isPersonalVoice: boolean;
};

type VoiceTesterProps = {
  visible: boolean;
  onClose: () => void;
};

const VoiceSamplerModule = Platform.OS === 'ios' ? NativeModules.VoiceSamplerModule : null;

export function VoiceTester({ visible, onClose }: VoiceTesterProps) {
  const [voices, setVoices] = useState<NativeVoice[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [personalVoiceStatus, setPersonalVoiceStatus] = useState<string>('unknown');
  const [requestingPersonalVoiceAccess, setRequestingPersonalVoiceAccess] = useState(false);
  const [sampleText, setSampleText] = useState(
    'The quick brown fox jumps over the lazy dog. This is the iOS voice tester.'
  );
  const [searchText, setSearchText] = useState('');
  const [englishOnly, setEnglishOnly] = useState(true);
  const [hideLegacyAndNovelty, setHideLegacyAndNovelty] = useState(true);
  const [hideSuperCompact, setHideSuperCompact] = useState(false);
  const [speakingVoiceID, setSpeakingVoiceID] = useState<string | null>(null);
  const [copiedVoiceID, setCopiedVoiceID] = useState<string | null>(null);
  const [copiedDump, setCopiedDump] = useState(false);

  const loadVoices = useCallback(() => {
    if (!VoiceSamplerModule?.listVoices) {
      setError('Voice sampler module is not available in this build.');
      return;
    }

    setLoading(true);
    setError(null);

    VoiceSamplerModule.listVoices()
      .then((result: NativeVoice[]) => {
        setVoices(Array.isArray(result) ? result : []);
      })
      .catch((err: unknown) => {
        const message =
          err instanceof Error ? err.message : 'Unable to load simulator voices.';
        setError(message);
      })
      .finally(() => {
        setLoading(false);
      });
  }, []);

  const loadPersonalVoiceStatus = useCallback(() => {
    if (!VoiceSamplerModule?.personalVoiceAuthorizationStatus) {
      setPersonalVoiceStatus('unavailable');
      return;
    }

    VoiceSamplerModule.personalVoiceAuthorizationStatus()
      .then((status: string) => {
        setPersonalVoiceStatus(typeof status === 'string' ? status : 'unknown');
      })
      .catch(() => {
        setPersonalVoiceStatus('unknown');
      });
  }, []);

  useEffect(() => {
    if (!visible) {
      return;
    }

    loadVoices();
    loadPersonalVoiceStatus();
  }, [visible, loadPersonalVoiceStatus, loadVoices]);

  const filteredVoices = useMemo(() => {
    const query = searchText.trim().toLowerCase();

    return voices.filter((voice) => {
      if (englishOnly && !voice.language.startsWith('en')) {
        return false;
      }

      if (hideLegacyAndNovelty && (voice.isEloquence || voice.isLegacyNovelty)) {
        return false;
      }

      if (hideSuperCompact && voice.isSuperCompact) {
        return false;
      }

      if (!query) {
        return true;
      }

      return (
        voice.name.toLowerCase().includes(query) ||
        voice.language.toLowerCase().includes(query) ||
        voice.id.toLowerCase().includes(query)
      );
    });
  }, [englishOnly, hideLegacyAndNovelty, hideSuperCompact, searchText, voices]);

  const handlePlay = (voice: NativeVoice) => {
    if (!VoiceSamplerModule?.speak) {
      return;
    }

    setSpeakingVoiceID(voice.id);
    VoiceSamplerModule.speak(voice.id, sampleText);
  };

  const handleStop = () => {
    setSpeakingVoiceID(null);
    VoiceSamplerModule?.stop?.();
  };

  const handleCopy = async (voice: NativeVoice) => {
    await Clipboard.setStringAsync(voice.id);
    setCopiedVoiceID(voice.id);
    setTimeout(() => {
      setCopiedVoiceID((current) => (current === voice.id ? null : current));
    }, 1500);
  };

  const handleCopyDump = async () => {
    await Clipboard.setStringAsync(JSON.stringify(voices, null, 2));
    setCopiedDump(true);
    setTimeout(() => {
      setCopiedDump(false);
    }, 1500);
  };

  const handleRequestPersonalVoiceAccess = async () => {
    if (!VoiceSamplerModule?.requestPersonalVoiceAuthorization) {
      return;
    }

    setRequestingPersonalVoiceAccess(true);
    try {
      const status = await VoiceSamplerModule.requestPersonalVoiceAuthorization();
      setPersonalVoiceStatus(typeof status === 'string' ? status : 'unknown');
      loadVoices();
    } catch {
      setPersonalVoiceStatus('unknown');
    } finally {
      setRequestingPersonalVoiceAccess(false);
    }
  };

  const personalVoiceCount = useMemo(
    () => voices.filter((voice) => voice.isPersonalVoice).length,
    [voices]
  );

  const personalVoiceStatusLabel = useMemo(() => {
    switch (personalVoiceStatus) {
      case 'authorized':
        return 'Authorized';
      case 'denied':
        return 'Denied';
      case 'notDetermined':
        return 'Not Requested';
      case 'unsupported':
        return 'Unsupported';
      case 'unavailable':
        return 'Unavailable';
      default:
        return 'Unknown';
    }
  }, [personalVoiceStatus]);

  const renderVoice = ({ item }: { item: NativeVoice }) => (
    <View style={styles.voiceCard}>
      <View style={styles.voiceHeader}>
        <View style={styles.voiceMeta}>
          <Text style={styles.voiceName}>{item.name}</Text>
          <Text style={styles.voiceSubtitle}>
            {item.language}  quality:{item.quality}  traits:{item.traits}
            {item.isPersonalVoice ? '  personal-voice' : ''}
          </Text>
          <Text style={styles.voiceIdentifier}>{item.id}</Text>
        </View>
        <View style={styles.voiceActions}>
          <TouchableOpacity style={styles.playButton} onPress={() => handlePlay(item)}>
            <Text style={styles.playButtonText}>
              {speakingVoiceID === item.id ? 'Replay' : 'Play'}
            </Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.copyButton} onPress={() => handleCopy(item)}>
            <Text style={styles.copyButtonText}>
              {copiedVoiceID === item.id ? 'Copied' : 'Copy ID'}
            </Text>
          </TouchableOpacity>
        </View>
      </View>
    </View>
  );

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <View style={styles.container}>
        <View style={styles.topBar}>
          <View style={styles.topBarCopy}>
            <Text style={styles.title}>iOS Voice Tester</Text>
            <Text style={styles.subtitle}>
              This shows whatever voices the current iOS runtime exposes. On simulator, this is closer to phone behavior than the Mac sampler, but still not a guarantee of the exact downloadable phone voice packs.
            </Text>
          </View>
          <TouchableOpacity style={styles.closeButton} onPress={onClose}>
            <Text style={styles.closeButtonText}>Done</Text>
          </TouchableOpacity>
        </View>

        <TextInput
          style={styles.searchInput}
          value={searchText}
          onChangeText={setSearchText}
          placeholder="Search name, language, or identifier"
          autoCapitalize="none"
          autoCorrect={false}
        />

        <TextInput
          style={styles.sampleInput}
          value={sampleText}
          onChangeText={setSampleText}
          multiline
          placeholder="Sample text to speak"
        />

        <View style={styles.filters}>
          <View style={styles.personalVoiceCard}>
            <View style={styles.personalVoiceCopy}>
              <Text style={styles.personalVoiceTitle}>Personal Voice</Text>
              <Text style={styles.personalVoiceText}>
                Status: {personalVoiceStatusLabel}
              </Text>
              <Text style={styles.personalVoiceText}>
                Personal voices found: {personalVoiceCount}
              </Text>
            </View>
            <TouchableOpacity
              style={styles.personalVoiceButton}
              onPress={handleRequestPersonalVoiceAccess}
              disabled={requestingPersonalVoiceAccess}
            >
              <Text style={styles.personalVoiceButtonText}>
                {requestingPersonalVoiceAccess ? 'Requesting...' : 'Request Access'}
              </Text>
            </TouchableOpacity>
          </View>

          <Pressable style={styles.filterRow} onPress={() => setEnglishOnly((value) => !value)}>
            <Text style={styles.filterLabel}>English only</Text>
            <Switch value={englishOnly} onValueChange={setEnglishOnly} />
          </Pressable>

          <Pressable
            style={styles.filterRow}
            onPress={() => setHideLegacyAndNovelty((value) => !value)}
          >
            <Text style={styles.filterLabel}>Hide legacy / novelty</Text>
            <Switch value={hideLegacyAndNovelty} onValueChange={setHideLegacyAndNovelty} />
          </Pressable>

          <Pressable
            style={styles.filterRow}
            onPress={() => setHideSuperCompact((value) => !value)}
          >
            <Text style={styles.filterLabel}>Hide super-compact</Text>
            <Switch value={hideSuperCompact} onValueChange={setHideSuperCompact} />
          </Pressable>
        </View>

        <View style={styles.listHeader}>
          <Text style={styles.countText}>
            {filteredVoices.length} shown / {voices.length} total
          </Text>
          <View style={styles.headerActions}>
            <TouchableOpacity style={styles.copyDumpButton} onPress={handleCopyDump}>
              <Text style={styles.copyDumpButtonText}>
                {copiedDump ? 'Copied Dump' : 'Copy Dump'}
              </Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.stopButton} onPress={handleStop}>
              <Text style={styles.stopButtonText}>Stop</Text>
            </TouchableOpacity>
          </View>
        </View>

        {loading ? (
          <View style={styles.centerState}>
            <ActivityIndicator size="large" color="#111827" />
          </View>
        ) : error ? (
          <View style={styles.centerState}>
            <Text style={styles.errorText}>{error}</Text>
          </View>
        ) : (
          <FlatList
            data={filteredVoices}
            keyExtractor={(item) => item.id}
            renderItem={renderVoice}
            contentContainerStyle={styles.listContent}
          />
        )}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F8FAFC',
    paddingTop: 60,
    paddingHorizontal: 16,
  },
  topBar: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 16,
    marginBottom: 16,
  },
  topBarCopy: {
    flex: 1,
    gap: 6,
  },
  title: {
    fontSize: 24,
    fontWeight: '700',
    color: '#111827',
  },
  subtitle: {
    fontSize: 13,
    lineHeight: 18,
    color: '#4B5563',
  },
  closeButton: {
    backgroundColor: '#111827',
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 10,
  },
  closeButtonText: {
    color: '#FFFFFF',
    fontWeight: '600',
  },
  searchInput: {
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#E5E7EB',
    paddingHorizontal: 12,
    paddingVertical: 12,
    fontSize: 15,
    marginBottom: 12,
  },
  sampleInput: {
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#E5E7EB',
    paddingHorizontal: 12,
    paddingVertical: 12,
    fontSize: 15,
    minHeight: 92,
    textAlignVertical: 'top',
    marginBottom: 12,
  },
  filters: {
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 8,
    marginBottom: 12,
    gap: 2,
  },
  personalVoiceCard: {
    gap: 10,
    paddingVertical: 8,
  },
  personalVoiceCopy: {
    gap: 2,
  },
  personalVoiceTitle: {
    fontSize: 15,
    fontWeight: '600',
    color: '#111827',
  },
  personalVoiceText: {
    fontSize: 13,
    color: '#4B5563',
  },
  personalVoiceButton: {
    backgroundColor: '#111827',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    alignItems: 'center',
  },
  personalVoiceButtonText: {
    color: '#FFFFFF',
    fontWeight: '600',
  },
  filterRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  filterLabel: {
    fontSize: 15,
    color: '#111827',
  },
  listHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  countText: {
    fontSize: 13,
    color: '#6B7280',
  },
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  copyDumpButton: {
    backgroundColor: '#E5E7EB',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 10,
  },
  copyDumpButtonText: {
    color: '#111827',
    fontWeight: '600',
  },
  stopButton: {
    backgroundColor: '#E5E7EB',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 10,
  },
  stopButtonText: {
    color: '#111827',
    fontWeight: '600',
  },
  listContent: {
    paddingBottom: 40,
  },
  voiceCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    padding: 14,
    marginBottom: 10,
  },
  voiceHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
  },
  voiceMeta: {
    flex: 1,
    gap: 4,
  },
  voiceName: {
    fontSize: 17,
    fontWeight: '600',
    color: '#111827',
  },
  voiceSubtitle: {
    fontSize: 13,
    color: '#6B7280',
  },
  voiceIdentifier: {
    fontSize: 11,
    lineHeight: 15,
    color: '#6B7280',
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
  },
  voiceActions: {
    gap: 8,
  },
  playButton: {
    backgroundColor: '#111827',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 9,
    alignItems: 'center',
  },
  playButtonText: {
    color: '#FFFFFF',
    fontWeight: '600',
  },
  copyButton: {
    backgroundColor: '#E5E7EB',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 9,
    alignItems: 'center',
  },
  copyButtonText: {
    color: '#111827',
    fontWeight: '600',
  },
  centerState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  errorText: {
    color: '#B91C1C',
    textAlign: 'center',
  },
});
