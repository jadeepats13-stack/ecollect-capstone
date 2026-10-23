// Resident app: how to sort and dispose of garbage (waste categories set by the barangay), with search,
// category chips and cards that open and close.
import React, { useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { getGuide } from '../data/resident';
import { useApi } from '../hooks';
import { FilterChips, Screen, SearchBox, StateView } from '../components/ui';
import { colors, radius, shadow, type } from '../theme';
import { IconCircle } from '../collector/parts';

const ICON = (name) => (/bio|food|kitchen|compost/i.test(name) ? 'leaf-outline' : /recycl/i.test(name) ? 'refresh-outline'
  : /hazard|toxic|special/i.test(name) ? 'warning-outline' : /residual/i.test(name) ? 'trash-outline' : 'pricetag-outline');

export default function GuideScreen() {
  const { data, error, loading, refreshing, reload, pull } = useApi(getGuide);
  const [search, setSearch] = useState('');
  const [cat, setCat] = useState('all');
  const [open, setOpen] = useState({});
  const list = data ?? [];
  const q = search.trim().toLowerCase();
  const shown = list.filter((c) => (cat === 'all' || String(c.waste_category_id) === cat)
    && (!q || `${c.category_name} ${c.disposal_guidelines ?? ''}`.toLowerCase().includes(q)));
  const isOpen = (c) => open[c.waste_category_id] ?? (!!q || cat !== 'all' || shown.length === 1);

  return (
    <Screen refreshing={refreshing} onRefresh={pull} style={{ paddingTop: 12 }}>
      <Text style={[type.small, { marginBottom: 12 }]}>How the barangay asks you to sort your garbage. Search for an item, for example “bottle” or “food”.</Text>
      <SearchBox value={search} onChangeText={setSearch} placeholder="Search the guide" />
      {list.length > 1 ? (
        <FilterChips value={cat} onChange={setCat}
          options={[['all', 'All', null], ...list.map((c) => [String(c.waste_category_id), c.category_name, null])]} />
      ) : null}
      <StateView loading={loading} error={error} onRetry={reload}
        empty={data && shown.length === 0}
        emptyTitle={list.length ? 'No matches' : 'No guide yet'}
        emptyText={list.length ? `Nothing in the guide mentions “${search.trim()}”. Ask the barangay office if you are not sure.` : 'The barangay hasn’t added waste categories yet.'} />
      {shown.map((c) => {
        const on = isOpen(c);
        return (
          <View key={c.waste_category_id} style={[{ backgroundColor: colors.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: on ? colors.primaryMid : colors.line, marginBottom: 12 }, shadow.card]}>
            <Pressable onPress={() => setOpen({ ...open, [c.waste_category_id]: !on })} accessibilityRole="button" accessibilityState={{ expanded: on }}
              style={{ flexDirection: 'row', alignItems: 'center', padding: 14 }}>
              <IconCircle name={ICON(c.category_name)} />
              <Text style={[type.heading, { marginLeft: 12, flex: 1 }]}>{c.category_name}</Text>
              <Ionicons name={on ? 'chevron-up' : 'chevron-down'} size={20} color={colors.faint} />
            </Pressable>
            {on ? (
              <View style={{ paddingHorizontal: 14, paddingBottom: 14, marginTop: -2 }}>
                <View style={{ height: 1, backgroundColor: colors.line, marginBottom: 12 }} />
                <Text style={[type.body, { color: c.disposal_guidelines ? colors.text : colors.faint }]} selectable>{c.disposal_guidelines || 'No guidelines written yet.'}</Text>
              </View>
            ) : null}
          </View>
        );
      })}
    </Screen>
  );
}
