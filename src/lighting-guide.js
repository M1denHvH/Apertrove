import { t, localized } from "./i18n.js";
const key = (x, y, height, detail) => ({ id: 'key', label: t("lightingGuide.key_light"), x, y, height, detail });
const reflector = (x, y, height, detail) => ({ id: 'reflector', label: t("lightingGuide.reflector"), x, y, height, detail });
const fill = (x, y, height, detail) => ({ id: 'fill', label: t("lightingGuide.fill_light"), x, y, height, detail });
const rim = (x, y, height, detail) => ({ id: 'rim', label: t("lightingGuide.rim_light"), x, y, height, detail });

export const SCHEMES = localized(() => ([
  {
    id: 'loop', name: 'Loop Lighting', title: t("lightingGuide.a_soft_shadow_beside_the_nose"),
    fixtures: [key(155, 249, t("lightingGuide.just_above_eye_level"), t("lightingGuide.place_a_softbox_about_30_45_off_the")), reflector(360, 227, t("lightingGuide.chest_height"), t("lightingGuide.optional_use_the_white_side_to_bounce_a"))],
    steps: [t("lightingGuide.ask_the_subject_to_face_the_camera_start"), t("lightingGuide.raise_the_light_and_move_it_to_the"), t("lightingGuide.keep_a_gap_between_the_nose_shadow_and")]
  },
  {
    id: 'rembrandt', name: 'Rembrandt Lighting', title: t("lightingGuide.a_triangle_of_light_on_the_shadowed_cheek"),
    fixtures: [key(111, 229, t("lightingGuide.above_eye_level"), t("lightingGuide.raise_the_light_and_move_it_roughly_45")), reflector(382, 237, t("lightingGuide.chest_height"), t("lightingGuide.optional_keep_the_reflector_farther_away_so_the"))],
    steps: [t("lightingGuide.start_with_loop_lighting_move_the_key_sideways"), t("lightingGuide.look_for_a_small_triangle_of_light_below"), t("lightingGuide.add_a_little_bounce_if_needed_and_check")]
  },
  {
    id: 'butterfly', name: 'Butterfly Lighting', title: t("lightingGuide.a_symmetrical_shadow_beneath_the_nose"),
    fixtures: [key(240, 224, t("lightingGuide.above_eye_level_on_axis"), t("lightingGuide.place_the_light_above_the_camera_and_angle")), reflector(240, 190, t("lightingGuide.below_the_chin"), t("lightingGuide.optional_a_little_bounce_softens_the_shadow_start"))],
    steps: [t("lightingGuide.have_the_subject_face_the_camera_and_raise"), t("lightingGuide.look_for_a_symmetrical_shadow_under_the_nose"), t("lightingGuide.check_the_catchlights_before_deciding_whether_to_add")]
  },
  {
    id: 'split', name: 'Split Lighting', title: t("lightingGuide.light_on_one_half_of_the_face"),
    fixtures: [key(94, 151, t("lightingGuide.around_eye_level"), t("lightingGuide.place_the_light_90_off_the_subject_s")), reflector(387, 157, t("lightingGuide.face_height"), t("lightingGuide.optional_a_white_reflector_lifts_shadows_a_black"))],
    steps: [t("lightingGuide.set_the_light_to_one_side_and_ask"), t("lightingGuide.check_that_the_light_and_shadow_split_roughly"), t("lightingGuide.move_the_reflector_back_or_remove_it_entirely")]
  },
  {
    id: 'clamshell', name: 'Clamshell Lighting', title: t("lightingGuide.soft_fill_from_below"),
    fixtures: [key(240, 232, t("lightingGuide.above_eye_level_on_axis"), t("lightingGuide.a_large_softbox_above_the_camera_provides_the")), reflector(240, 193, t("lightingGuide.below_the_chin_on_axis"), t("lightingGuide.lift_a_white_reflector_toward_the_face_from"))],
    steps: [t("lightingGuide.start_with_butterfly_lighting_and_put_a_white"), t("lightingGuide.shoot_through_the_gap_raise_the_reflector_until"), t("lightingGuide.keep_the_top_light_stronger_to_preserve_shape")]
  },
  {
    id: 'three', name: 'Three-Point Lighting', title: t("lightingGuide.key_fill_and_rim_light"),
    fixtures: [key(122, 216, t("lightingGuide.above_eye_level"), t("lightingGuide.a_soft_key_to_the_left_of_the")), fill(355, 235, t("lightingGuide.around_eye_level"), t("lightingGuide.put_the_fill_on_the_opposite_side_start")), rim(344, 76, t("lightingGuide.above_shoulder_height"), t("lightingGuide.aim_from_behind_at_the_hair_and_shoulders"))],
    steps: [t("lightingGuide.set_exposure_for_the_key_light"), t("lightingGuide.add_fill_and_compare_the_contrast_to_the"), t("lightingGuide.turn_on_the_rim_light_check_the_hair")]
  },
  {
    id: 'rgb', name: 'Creative RGB Lighting', title: t("lightingGuide.color_on_the_backdrop_and_rim_neutral_skin"),
    fixtures: [key(125, 218, t("lightingGuide.above_eye_level"), t("lightingGuide.use_a_white_light_in_a_softbox_set")), { id: 'background', label: t("lightingGuide.rgb_background_light"), x: 156, y: 104, height: t("lightingGuide.below_shoulder_height_aimed_at_the_backdrop"), detail: t("lightingGuide.aim_the_rgb_light_away_from_the_subject") }, rim(358, 84, t("lightingGuide.around_shoulder_height"), t("lightingGuide.set_the_colored_light_behind_the_subject_off"))],
    steps: [t("lightingGuide.move_the_subject_away_from_the_backdrop_so"), t("lightingGuide.turn_on_the_background_and_rim_lights_one"), t("lightingGuide.check_the_face_and_rgb_channels_on_a")]
  }
]));

export const CREATIVE_PRESETS = localized(() => ([
  { name: 'Reels', scheme: 'three', hex: '#438EAD', harmony: 'analogous', gear: t("lightingGuide.three_continuous_led_lights_a_softbox_and_a"), steps: [t("lightingGuide.turn_the_camera_vertically_and_check_the_9"), t("lightingGuide.soften_shadows_with_fill_and_keep_a_cool"), t("lightingGuide.for_video_check_for_led_flicker_at_your")], result: t("lightingGuide.a_clear_face_and_good_background_separation_in") },
  { name: 'Creative', scheme: 'rembrandt', hex: '#B66840', harmony: 'split', gear: t("lightingGuide.a_softbox_a_white_reflector_an_rgb_background"), steps: [t("lightingGuide.shape_a_light_triangle_on_the_shadowed_cheek"), t("lightingGuide.aim_the_cool_color_from_the_palette_at"), t("lightingGuide.keep_the_fill_low_and_check_the_shadow")], result: t("lightingGuide.a_warm_portrait_with_deep_shadows_and_a") },
  { name: 'Trendy', scheme: 'loop', hex: '#B36681', harmony: 'analogous', gear: t("lightingGuide.a_softbox_a_reflector_a_pastel_backdrop_and"), steps: [t("lightingGuide.choose_a_pastel_backdrop_in_a_nearby_hue"), t("lightingGuide.set_up_loop_lighting_and_soften_the_shadow"), t("lightingGuide.add_a_subtle_color_from_behind_or_bring")], result: t("lightingGuide.soft_shadows_with_clothing_and_background_close_in") },
  { name: 'Colorful', scheme: 'rgb', hex: '#DB456B', harmony: 'triadic', gear: t("lightingGuide.two_rgb_lights_a_white_light_with_a"), steps: [t("lightingGuide.expose_for_the_face_under_white_light"), t("lightingGuide.use_separate_colors_for_the_backdrop_and_far"), t("lightingGuide.check_the_histogram_to_preserve_detail_in_each")], result: t("lightingGuide.distinct_saturated_colors_with_natural_legible_skin_tones") },
  { name: 'Beauty', scheme: 'clamshell', hex: '#B69B85', harmony: 'mono', gear: t("lightingGuide.a_large_softbox_a_white_reflector_and_a"), steps: [t("lightingGuide.place_the_softbox_above_the_camera_and_the"), t("lightingGuide.use_a_neutral_backdrop_and_keep_the_lights"), t("lightingGuide.adjust_the_bounce_from_below_keeping_natural_skin")], result: t("lightingGuide.a_softly_lit_portrait_with_clear_eyes_and") }
]));
