import { parseDocs, type StaticData } from "./staticData.ts";

/**
 * A miniature stand-in for the game's `en-US.json`, in the same grouped shape:
 * an array of `{ NativeClass, Classes }`, with every value a string exactly as the
 * game's exporter writes them — including the quoted-class-path syntax used for
 * recipe ingredients and the x1000 scaling the dump applies to fluids.
 *
 * Test-only helper — excluded from the production build (see tsconfig.json).
 */
export const docsFixture = [
  {
    NativeClass: "/Script/CoreUObject.Class'/Script/FactoryGame.FGItemDescriptor'",
    Classes: [
      {
        ClassName: "Desc_IronPlate_C",
        mDisplayName: "Iron Plate",
        mDescription: "Used for crafting.",
        mForm: "RF_SOLID",
        mResourceSinkPoints: "6",
      },
      {
        ClassName: "Desc_IronIngot_C",
        mDisplayName: "Iron Ingot",
        mForm: "RF_SOLID",
      },
      {
        ClassName: "Desc_Cement_C",
        mDisplayName: "Concrete",
        mForm: "RF_SOLID",
      },
      {
        ClassName: "Desc_Water_C",
        mDisplayName: "Water",
        mDescription: "Pure water.",
        mForm: "RF_LIQUID",
        mResourceSinkPoints: "0",
      },
    ],
  },
  {
    NativeClass: "/Script/CoreUObject.Class'/Script/FactoryGame.FGRecipe'",
    Classes: [
      {
        ClassName: "Recipe_IronPlate_C",
        mDisplayName: "Iron Plate",
        mIngredients:
          "((ItemClass=\"/Script/Engine.BlueprintGeneratedClass'/Game/FactoryGame/Resource/Parts/IronIngot/Desc_IronIngot.Desc_IronIngot_C'\",Amount=3))",
        mProduct:
          "((ItemClass=\"/Script/Engine.BlueprintGeneratedClass'/Game/FactoryGame/Resource/Parts/IronPlate/Desc_IronPlate.Desc_IronPlate_C'\",Amount=2))",
        mManufactoringDuration: "6.000000",
        mProducedIn:
          '("/Game/FactoryGame/Buildable/Factory/ConstructorMk1/Build_ConstructorMk1.Build_ConstructorMk1_C")',
      },
      {
        ClassName: "Recipe_Water_C",
        mDisplayName: "Water",
        mIngredients: "",
        mProduct:
          "((ItemClass=\"/Script/Engine.BlueprintGeneratedClass'/Game/FactoryGame/Resource/RawResources/Water/Desc_Water.Desc_Water_C'\",Amount=2000))",
        mManufactoringDuration: "1.000000",
        mProducedIn:
          '("/Game/FactoryGame/Buildable/Factory/WaterPump/Build_WaterPump.Build_WaterPump_C")',
      },
    ],
  },
  {
    NativeClass: "/Script/CoreUObject.Class'/Script/FactoryGame.FGBuildableGeneratorFuel'",
    Classes: [
      {
        ClassName: "Build_GeneratorCoal_C",
        mDisplayName: "Coal-Powered Generator",
        mPowerProduction: "75.000000",
      },
    ],
  },
  {
    NativeClass: "/Script/CoreUObject.Class'/Script/FactoryGame.FGBuildableManufacturer'",
    Classes: [
      {
        ClassName: "Build_ConstructorMk1_C",
        mDisplayName: "Constructor",
        mPowerConsumption: "4.000000",
      },
    ],
  },
  {
    NativeClass: "/Script/CoreUObject.Class'/Script/FactoryGame.FGBuildablePowerStorage'",
    Classes: [
      {
        ClassName: "Build_PowerStorageMk1_C",
        mDisplayName: "Power Storage",
        mPowerStoreCapacity: "100.000000",
      },
    ],
  },
  {
    NativeClass: "/Script/CoreUObject.Class'/Script/FactoryGame.FGBuildableStorage'",
    Classes: [
      {
        ClassName: "Build_StorageContainerMk1_C",
        mDisplayName: "Storage Container",
      },
    ],
  },
  {
    NativeClass: "/Script/CoreUObject.Class'/Script/FactoryGame.FGSchematic'",
    Classes: [
      {
        ClassName: "Schematic_8-5_C",
        mDisplayName: "Particle Enrichment",
        mType: "EST_Milestone",
        mTechTier: "8",
      },
    ],
  },
];

/** Indexed static data over {@link docsFixture}. */
export function testStaticData(): StaticData {
  return parseDocs(docsFixture);
}

/** Encode a value the way the game ships its Docs file: UTF-16 LE with a BOM. */
export function encodeAsGameDocs(value: unknown): Buffer {
  return Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(JSON.stringify(value), "utf16le")]);
}
